package com.loganalyzer.backend;

import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import static com.loganalyzer.backend.ApiModels.*;

@Component
public class AnalysisWorker {
    private static final Logger log=LoggerFactory.getLogger(AnalysisWorker.class);
    private final JobStore store;
    private final FastApiClient ai;
    private final AiResponseValidator validator;
    private final BackendProperties properties;
    private final ThreadPoolTaskExecutor executor;
    private final Semaphore slots;
    private final ConcurrentMap<UUID,UUID> active=new ConcurrentHashMap<>();
    public AnalysisWorker(JobStore store,FastApiClient ai,AiResponseValidator validator,BackendProperties properties,
            @Qualifier("analysisExecutor") ThreadPoolTaskExecutor executor) {
        this.store=store; this.ai=ai; this.validator=validator; this.properties=properties;
        slots=new Semaphore(properties.parallelism());
        this.executor=executor;
    }

    @Scheduled(fixedDelayString="${analyzer.poll-delay}",initialDelayString="${analyzer.poll-delay}")
    public void dispatch() {
        if (!properties.workerEnabled()) return;
        while (slots.tryAcquire()) {
            ClaimedJob claimed=null;
            try {
                var next=store.claim();
                if (next.isEmpty()) { slots.release(); return; }
                ClaimedJob job=next.get();
                claimed=job;
                active.put(job.id(),job.leaseToken());
                executor.execute(() -> process(job));
            } catch (RuntimeException failure) {
                slots.release();
                if (claimed!=null) {
                    active.remove(claimed.id(),claimed.leaseToken());
                    recordFailure(claimed,new AiFailure("WORKER_STOPPING","Worker could not accept job",true,null));
                }
                log.error("Cannot dispatch persisted analysis",failure); return;
            }
        }
    }
    private void process(ClaimedJob job) {
        try {
            var response=ai.analyze(job.input(),job.filename());
            validator.validate(response);
            if (!store.complete(job,response)) log.info("Discarded stale completion for {}",job.id());
        } catch (AiFailure failure) {
            recordFailure(job,failure);
        } catch (Exception failure) {
            log.error("Analysis {} failed",job.id(),failure);
            recordFailure(job,new AiFailure("PROCESSING_ERROR","Analysis processing failed",true,null));
        } finally {
            active.remove(job.id(),job.leaseToken()); slots.release();
        }
    }
    private void recordFailure(ClaimedJob job,AiFailure failure) {
        try { store.fail(job,failure); }
        catch (RuntimeException unavailable) {
            // A database outage must not lose the job: another worker recovers the lease.
            log.error("Could not persist failure for {}; lease recovery will retry",job.id(),unavailable);
        }
    }
    @Scheduled(fixedDelayString="${analyzer.heartbeat-delay}")
    public void heartbeat() {
        active.forEach((id,token) -> {
            try { if (!store.heartbeat(id,token)) active.remove(id,token); }
            catch (RuntimeException unavailable) { log.warn("Could not renew analysis lease {}",id,unavailable); }
        });
    }
}

