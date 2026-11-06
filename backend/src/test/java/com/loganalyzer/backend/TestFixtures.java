package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.*;
import java.io.IOException;
import java.net.URI;
import java.time.Duration;

final class TestFixtures {
    static final ObjectMapper JSON=new ObjectMapper();
    static JsonNode response() {
        try (var input=TestFixtures.class.getResourceAsStream("/ai-success.json")) {
            return JSON.readTree(input);
        } catch (IOException error) { throw new IllegalStateException(error); }
    }
    static BackendProperties properties(URI url,long maxSize) {
        return new BackendProperties(maxSize,2,url,Duration.ofSeconds(1),Duration.ofSeconds(2),
            Duration.ofMillis(100),Duration.ofMillis(100),Duration.ofSeconds(2),
            Duration.ofMillis(20),2,1,false);
    }
}

