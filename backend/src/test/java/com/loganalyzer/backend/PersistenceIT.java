package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.assertj.core.api.Assertions.*;
import static com.loganalyzer.backend.ApiModels.*;

@SpringBootTest(properties={"spring.datasource.hikari.maximum-pool-size=4","analyzer.worker-enabled=false","analyzer.max-pending-jobs=2",
    "analyzer.max-attempts=2","analyzer.lease-duration=2s","analyzer.heartbeat-delay=100ms"})
@AutoConfigureMockMvc
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class PersistenceIT extends PostgresTestSupport {
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) { database(registry); }
    @Autowired JobStore store;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @BeforeEach void clear() { jdbc.update("DELETE FROM analysis_jobs"); }
    Job create(String key) { return store.create("x.log","text/plain","log".getBytes(),"a".repeat(64),key); }
    @Test void flywayMigratesRealPostgresAndIdempotencyIsDurable() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE success",Integer.class)).isEqualTo(1);
        Job first=create("upload-1");
        assertThat(create("upload-1").id()).isEqualTo(first.id());
        assertThatThrownBy(() -> store.create("x.log","text/plain","other".getBytes(),"b".repeat(64),"upload-1"))
            .isInstanceOf(ApiFailure.class).extracting("status").isEqualTo(409);
        create("upload-2");
        assertThatThrownBy(() -> create("upload-3")).isInstanceOf(ApiFailure.class).extracting("status").isEqualTo(429);
        store.cancel(first.id());
        assertThat(create("upload-3").status()).isEqualTo(JobStatus.QUEUED);
    }
    @Test void completedResultEventsAndEvidenceCommitTogetherAndCascadeOnDelete() {
        Job job=create(null);
        ClaimedJob claim=store.claim().orElseThrow();
        JsonNode response=TestFixtures.response();
        assertThat(store.complete(claim,response)).isTrue();
        assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.COMPLETED);
        assertThat(store.result(job.id())).isEqualTo(response);
        assertThat(store.events(job.id(),0,20).totalElements()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analysis_evidence WHERE job_id=?",Integer.class,job.id()))
            .isPositive();
        store.delete(job.id());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analysis_attempts",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analysis_evidence",Integer.class)).isZero();
    }
    @Test void expiredWorkerCannotOverwriteRecoveredJob() {
        Job job=create(null);
        ClaimedJob old=store.claim().orElseThrow();
        jdbc.update("UPDATE analysis_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=?",job.id());
        ClaimedJob recovered=store.claim().orElseThrow();
        assertThat(recovered.leaseToken()).isNotEqualTo(old.leaseToken());
        assertThat(store.complete(old,TestFixtures.response())).isFalse();
        assertThat(store.complete(recovered,TestFixtures.response())).isTrue();
        assertThat(store.attempts(job.id())).extracting(Attempt::outcome).containsExactly("LEASE_EXPIRED","SUCCEEDED");
    }
    @Test void repeatedWorkerCrashesExhaustTheAttemptBudget() {
        Job job=create(null);
        for(int i=0;i<2;i++) {
            assertThat(store.claim()).isPresent();
            jdbc.update("UPDATE analysis_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=?",job.id());
        }
        assertThat(store.claim()).isEmpty();
        assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.FAILED);
        assertThat(store.get(job.id()).errorCode()).isEqualTo("ATTEMPTS_EXHAUSTED");
        assertThat(store.attempts(job.id())).extracting(Attempt::outcome).containsExactly("LEASE_EXPIRED","LEASE_EXPIRED");
    }
    @Test void exhaustionAndManualRetryRetainHistory() {
        Job job=create(null);
        var claim=store.claim().orElseThrow();
        store.fail(claim,new AiFailure("AI_HTTP_422","Invalid log",false,422));
        assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.FAILED);
        store.retry(job.id());
        var second=store.claim().orElseThrow();
        assertThat(second.attemptCount()).isEqualTo(2);
        assertThat(second.cycleAttempts()).isEqualTo(1);
        store.cancel(job.id());
        assertThat(store.complete(second,TestFixtures.response())).isFalse();
        assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.CANCELLED);
        assertThat(store.attempts(job.id())).hasSize(2);
    }
    @Test void claimsEnforceGlobalCapacityAcrossConcurrentDispatchers() throws Exception {
        create(null); create(null);
        try (var executor=Executors.newFixedThreadPool(2)) {
            var a=executor.submit(store::claim);
            var b=executor.submit(store::claim);
            assertThat(List.of(a.get(),b.get()).stream().filter(Optional::isPresent).count()).isEqualTo(1);
        }
    }
    @Test void unverifiedEvidenceGetsExplicitWarningsStatus() {
        var job=create(null);
        var response=TestFixtures.response();
        ((com.fasterxml.jackson.databind.node.ObjectNode)response.path("validation")).put("valid",false);
        ((com.fasterxml.jackson.databind.node.ArrayNode)response.path("validation").path("errors")).add("not found");
        assertThat(store.complete(store.claim().orElseThrow(),response)).isTrue();
        assertThat(store.get(job.id()).status()).isEqualTo(JobStatus.COMPLETED_WITH_WARNINGS);
        assertThat(store.result(job.id()).path("validation").path("valid").booleanValue()).isFalse();
    }
    @Test void publicApiValidatesUploadsAndExposesPaginationAndStateConflicts() throws Exception {
        var uploaded=mvc.perform(multipart("/api/v1/analyses")
            .file(new MockMultipartFile("file","app.log","text/plain","log".getBytes()))
            .header("Idempotency-Key","api-test"))
            .andExpect(status().isAccepted()).andExpect(header().exists("Location")).andReturn();
        String id=TestFixtures.JSON.readTree(uploaded.getResponse().getContentAsString()).path("id").textValue();
        mvc.perform(get("/api/v1/analyses/"+id+"/result")).andExpect(status().isConflict());
        mvc.perform(get("/api/v1/analyses?page=0&size=1")).andExpect(status().isOk())
            .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/v1/analyses?size=101")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/analyses/"+UUID.randomUUID())).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/analyses/"+id+"/cancel")).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("CANCELLED"));
        mvc.perform(delete("/api/v1/analyses/"+id)).andExpect(status().isNoContent());
    }
}

