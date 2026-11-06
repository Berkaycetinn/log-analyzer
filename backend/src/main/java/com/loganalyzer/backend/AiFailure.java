package com.loganalyzer.backend;

public class AiFailure extends RuntimeException {
    private final String code;
    private final boolean retryable;
    private final Integer upstreamStatus;
    public AiFailure(String code, String message, boolean retryable, Integer upstreamStatus) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.upstreamStatus = upstreamStatus;
    }
    public String code() { return code; }
    public boolean retryable() { return retryable; }
    public Integer upstreamStatus() { return upstreamStatus; }
}

