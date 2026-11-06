package com.loganalyzer.backend;

public enum JobStatus {
    QUEUED, PROCESSING, COMPLETED, COMPLETED_WITH_WARNINGS, FAILED, CANCELLED;
    public boolean hasResult() {
        return this == COMPLETED || this == COMPLETED_WITH_WARNINGS;
    }
    public boolean terminal() {
        return hasResult() || this == FAILED || this == CANCELLED;
    }
}

