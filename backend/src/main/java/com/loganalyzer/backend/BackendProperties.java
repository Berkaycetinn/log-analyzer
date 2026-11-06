package com.loganalyzer.backend;

import java.net.URI;
import java.time.Duration;
import jakarta.annotation.PostConstruct;
import jakarta.validation.constraints.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties("analyzer")
@Validated
public record BackendProperties(
    @Min(1) @Max(10000000) long maxUploadBytes,
    @Min(1) int maxPendingJobs,
    @NotNull URI aiUrl,
    @NotNull Duration connectTimeout,
    @NotNull Duration readTimeout,
    @NotNull Duration pollDelay,
    @NotNull Duration heartbeatDelay,
    @NotNull Duration leaseDuration,
    @NotNull Duration retryDelay,
    @Min(1) @Max(100) int maxAttempts,
    @Min(1) @Max(8) int parallelism,
    boolean workerEnabled
) {
    @PostConstruct
    void validateDurations() {
        for (Duration duration : new Duration[]{connectTimeout, readTimeout, pollDelay,
                heartbeatDelay, leaseDuration, retryDelay}) {
            if (duration.isNegative() || duration.isZero()) {
                throw new IllegalArgumentException("Analyzer durations must be positive");
            }
        }
        if (leaseDuration.compareTo(heartbeatDelay.multipliedBy(2)) <= 0) {
            throw new IllegalArgumentException("Lease duration must exceed twice heartbeat delay");
        }
        if (!"http".equals(aiUrl.getScheme()) && !"https".equals(aiUrl.getScheme())) {
            throw new IllegalArgumentException("AI URL must use http or https");
        }
    }
}

