package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Set;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;

@RestController
@RequestMapping("/api/v1/system")
public class AiStatusController {
    public record Status(boolean available, boolean modelsLoaded, String modelState, String device) {}
    private final RestClient client;
    public AiStatusController(BackendProperties properties) {
        var http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(2)).build();
        var factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofSeconds(3));
        client = RestClient.builder().baseUrl(properties.aiUrl().toString()).requestFactory(factory).build();
    }
    @GetMapping("/ai")
    public Status status() {
        try {
            JsonNode response = client.get().uri("/health").retrieve().body(JsonNode.class);
            if (response == null || !"ok".equals(response.path("status").asText())) return unavailable();
            String state = response.path("model_state").asText("unknown");
            if (!Set.of("ready", "loading", "unloaded", "error").contains(state)) state = "unknown";
            boolean ready = "ready".equals(state) && response.path("models_loaded").asBoolean(false);
            String device = response.path("device").asText("unknown");
            if (!Set.of("cpu", "cuda", "mps").contains(device)) device = "unknown";
            return new Status(true, ready, state, device);
        } catch (RuntimeException unavailable) {
            return unavailable();
        }
    }
    private Status unavailable() { return new Status(false, false, "unavailable", "unknown"); }
}
