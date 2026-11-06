package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.net.http.HttpClient;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.*;

@Component
public class FastApiClient {
    private final RestClient client;
    public FastApiClient(BackendProperties properties) {
        HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(properties.connectTimeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(properties.readTimeout());
        client = RestClient.builder().baseUrl(properties.aiUrl().toString())
            .requestFactory(factory).build();
    }
    public JsonNode analyze(byte[] data, String filename) {
        ByteArrayResource resource = new ByteArrayResource(data) {
            @Override public String getFilename() { return filename; }
        };
        var body = new LinkedMultiValueMap<String, Object>();
        body.add("file", new HttpEntity<>(resource,
            new HttpHeaders() {{ setContentType(MediaType.TEXT_PLAIN); }}));
        try {
            JsonNode response = client.post().uri("/analyze")
                .contentType(MediaType.MULTIPART_FORM_DATA).body(body)
                .retrieve().body(JsonNode.class);
            if (response == null) {
                throw new AiFailure("AI_INVALID_RESPONSE", "AI service returned an empty response", false, 200);
            }
            return response;
        } catch (RestClientResponseException error) {
            int status = error.getStatusCode().value();
            boolean retryable = status == 429 || status >= 500;
            throw new AiFailure("AI_HTTP_" + status,
                "AI service returned HTTP " + status, retryable, status);
        } catch (ResourceAccessException error) {
            throw new AiFailure("AI_UNAVAILABLE", "AI service connection failed or timed out", true, null);
        } catch (RestClientException error) {
            throw new AiFailure("AI_INVALID_RESPONSE", "AI service returned an unreadable response", false, null);
        }
    }
}

