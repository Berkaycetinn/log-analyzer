package com.loganalyzer.backend;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
import static org.assertj.core.api.Assertions.*;

class AiStatusControllerTest {
    HttpServer server;
    URI base;
    String response;
    @BeforeEach void start() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/health", exchange -> {
            byte[] body=response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type","application/json");
            exchange.sendResponseHeaders(200,body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        server.start(); base=URI.create("http://127.0.0.1:"+server.getAddress().getPort());
    }
    @AfterEach void stop() { server.stop(0); }
    @Test void healthyProcessDoesNotPretendModelsAreReady() {
        response="{\"status\":\"ok\",\"model_state\":\"loading\",\"models_loaded\":false,\"device\":\"cpu\"}";
        var status=new AiStatusController(TestFixtures.properties(base,1000)).status();
        assertThat(status.available()).isTrue(); assertThat(status.modelsLoaded()).isFalse();
        assertThat(status.modelState()).isEqualTo("loading");
    }
    @Test void exposesVerifiedReadyStateAndNoServerPaths() {
        response="{\"status\":\"ok\",\"model_state\":\"ready\",\"models_loaded\":true,\"device\":\"cpu\",\"llm_model\":\"private/path\"}";
        var status=new AiStatusController(TestFixtures.properties(base,1000)).status();
        assertThat(status.modelsLoaded()).isTrue(); assertThat(status.device()).isEqualTo("cpu");
        assertThat(status.toString()).doesNotContain("private/path");
    }
    @Test void invalidHealthResponseIsUnavailable() {
        response="not JSON";
        var status=new AiStatusController(TestFixtures.properties(base,1000)).status();
        assertThat(status.available()).isFalse(); assertThat(status.modelState()).isEqualTo("unavailable");
    }
}
