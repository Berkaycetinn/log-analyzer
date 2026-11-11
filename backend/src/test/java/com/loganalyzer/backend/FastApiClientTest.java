package com.loganalyzer.backend;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import static org.assertj.core.api.Assertions.*;

class FastApiClientTest {
    HttpServer server;
    ExecutorService executor;
    URI base;
    @BeforeEach void start() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        executor=Executors.newCachedThreadPool();
        server.setExecutor(executor);
        server.start();
        base=URI.create("http://127.0.0.1:"+server.getAddress().getPort());
    }
    @AfterEach void stop() { server.stop(0); executor.shutdownNow(); }
    @Test void sendsMultipartFileAndReadsRealContract() {
        var received=new AtomicReference<String>();
        var upgrade=new AtomicReference<String>();
        server.createContext("/analyze",exchange -> {
            received.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
            upgrade.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            byte[] body=TestFixtures.response().toString().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type","application/json");
            exchange.sendResponseHeaders(200,body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        var response=new FastApiClient(TestFixtures.properties(base,1000)).analyze("original log\n".getBytes(),"app.log");
        assertThat(response.path("validation").path("valid").booleanValue()).isTrue();
        assertThat(received.get()).contains("name=\"file\"","filename=\"app.log\"","original log\n");
        assertThat(upgrade.get()).isNull();
    }
    @Test void retriesBusyServiceButNotInvalidInput() {
        var status=new java.util.concurrent.atomic.AtomicInteger(503);
        server.createContext("/analyze",exchange -> {
            exchange.sendResponseHeaders(status.get(),-1); exchange.close();
        });
        var client=new FastApiClient(TestFixtures.properties(base,1000));
        assertThatThrownBy(() -> client.analyze(new byte[]{1},"x.log")).isInstanceOf(AiFailure.class)
            .satisfies(error -> assertThat(((AiFailure)error).retryable()).isTrue());
        status.set(422);
        assertThatThrownBy(() -> client.analyze(new byte[]{1},"x.log")).isInstanceOf(AiFailure.class)
            .satisfies(error -> assertThat(((AiFailure)error).retryable()).isFalse());
    }
    @Test void reportFailuresAreSpecificAndNotRetried() {
        var code=new AtomicReference<>("REPORT_LANGUAGE_INVALID");
        server.createContext("/analyze", exchange -> {
            byte[] body=("{\"detail\":{\"code\":\""+code.get()+"\",\"message\":\"private upstream text\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type","application/json");
            exchange.sendResponseHeaders(422,body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        for (String kind : new String[]{"REPORT_LANGUAGE_INVALID", "REPORT_PLAN_INVALID"}) {
            code.set(kind);
            assertThatThrownBy(() -> new FastApiClient(TestFixtures.properties(base,1000)).analyze(new byte[]{1},"x"))
            .isInstanceOfSatisfying(AiFailure.class, error -> {
                assertThat(error.code()).isEqualTo("AI_"+kind);
                assertThat(error.retryable()).isFalse();
                assertThat(error.getMessage()).doesNotContain("private upstream text");
            });
        }
    }
    @Test void rejectsNonJsonResponse() {
        server.createContext("/analyze",exchange -> {
            byte[] body="not JSON".getBytes();
            exchange.getResponseHeaders().set("Content-Type","application/json");
            exchange.sendResponseHeaders(200,body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        assertThatThrownBy(() -> new FastApiClient(TestFixtures.properties(base,1000)).analyze(new byte[]{1},"x"))
            .isInstanceOf(AiFailure.class).extracting("code").isEqualTo("AI_INVALID_RESPONSE");
    }
}

