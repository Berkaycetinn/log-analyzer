package com.loganalyzer.backend;

import com.sun.net.httpserver.*;
import java.io.IOException;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.annotation.DirtiesContext;
import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

@SpringBootTest(properties={"spring.datasource.hikari.maximum-pool-size=4","analyzer.worker-enabled=true","analyzer.poll-delay=50ms",
    "analyzer.heartbeat-delay=100ms","analyzer.lease-duration=1s","analyzer.max-attempts=2",
    "analyzer.retry-delay=20ms","analyzer.read-timeout=3s"})
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class AsyncProcessingIT extends PostgresTestSupport {
    static final HttpServer AI;
    static final ExecutorService HTTP=Executors.newCachedThreadPool();
    static final AtomicInteger calls=new AtomicInteger();
    static final AtomicInteger mode=new AtomicInteger(200);
    static final AtomicLong delay=new AtomicLong();
    static final AtomicReference<String> body=new AtomicReference<>();
    static {
        try {
            AI=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            AI.setExecutor(HTTP);
            AI.createContext("/analyze",exchange -> {
                body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
                int call=calls.incrementAndGet();
                int response=mode.get();
                if(delay.get()>0) {
                    try { Thread.sleep(delay.get()); }
                    catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); exchange.close(); return; }
                }
                if (response==503 && call>1) response=200;
                byte[] data=TestFixtures.response().toString().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type","application/json");
                exchange.sendResponseHeaders(response,response==200 ? data.length : -1);
                if (response==200) exchange.getResponseBody().write(data);
                exchange.close();
            });
            AI.start();
        } catch(IOException error) { throw new ExceptionInInitializerError(error); }
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        database(registry);
        registry.add("analyzer.ai-url",() -> "http://127.0.0.1:"+AI.getAddress().getPort());
    }
    @Autowired JobStore store;
    @Autowired JdbcTemplate jdbc;
    @BeforeEach void clear() {
        jdbc.update("DELETE FROM analysis_jobs");
        calls.set(0); mode.set(200); delay.set(0);
    }
    @AfterAll static void stop() { AI.stop(0); HTTP.shutdownNow(); }
    @Test void backgroundWorkerCallsHttpAndPersistsResult() {
        var job=store.create("actual.log","text/plain","unaltered bytes\n".getBytes(),"a".repeat(64),null);
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
            assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.COMPLETED));
        assertThat(body.get()).contains("unaltered bytes\n","filename=\"actual.log\"");
        assertThat(store.result(job.id()).path("run_id").isTextual()).isTrue();
        assertThat(store.attempts(job.id())).hasSize(1);
    }
    @Test void busyServiceIsRetriedWithoutLosingTheInput() {
        mode.set(503);
        var job=store.create("x.log","text/plain","retry payload".getBytes(),"a".repeat(64),null);
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
            assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.COMPLETED));
        assertThat(calls.get()).isEqualTo(2);
        assertThat(store.attempts(job.id())).extracting(ApiModels.Attempt::outcome)
            .containsExactly("RETRY_SCHEDULED","SUCCEEDED");
    }
    @Test void invalidInputIsTerminalAndNeverPersistsAReport() {
        mode.set(422);
        var job=store.create("x.log","text/plain","invalid".getBytes(),"a".repeat(64),null);
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
            assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.FAILED));
        assertThat(calls.get()).isEqualTo(1);
        assertThat(store.get(job.id()).upstreamStatus()).isEqualTo(422);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analysis_events WHERE job_id=?",Integer.class,job.id())).isZero();
    }
    @Test void heartbeatKeepsLongRunningInferenceOwned() {
        delay.set(1500);
        var job=store.create("x.log","text/plain","slow request".getBytes(),"a".repeat(64),null);
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
            assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.COMPLETED));
        assertThat(calls.get()).isEqualTo(1);
        assertThat(store.attempts(job.id())).extracting(ApiModels.Attempt::outcome).containsExactly("SUCCEEDED");
    }
    @Test void retryableFailureStopsAtConfiguredBudget() {
        mode.set(500);
        var job=store.create("x.log","text/plain","unavailable".getBytes(),"a".repeat(64),null);
        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
            assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.FAILED));
        assertThat(calls.get()).isEqualTo(2);
        assertThat(store.attempts(job.id())).extracting(ApiModels.Attempt::outcome)
            .containsExactly("RETRY_SCHEDULED","FAILED");
    }
}

