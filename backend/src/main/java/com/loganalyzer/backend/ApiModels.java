package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ApiModels {
    private ApiModels() {}
    public record Job(UUID id, String filename, String contentType, long sizeBytes,
        String sha256, JobStatus status, int attemptCount, int cycleAttempts,
        Instant createdAt, Instant updatedAt, Instant startedAt, Instant finishedAt,
        Instant nextAttemptAt, String errorCode, String errorMessage, Integer upstreamStatus) {}
    public record Page<T>(List<T> content, int page, int size, long totalElements) {}
    public record Event(int eventId, String start, String end, int rowCount,
        String severity, String confidence, JsonNode source, JsonNode analysis) {}
    public record Attempt(int attemptNo, Instant startedAt, Instant finishedAt,
        String outcome, String errorCode, String errorMessage, Integer upstreamStatus) {}
    public record ClaimedJob(UUID id, String filename, byte[] input, UUID leaseToken,
        int attemptCount, int cycleAttempts) {}
}

