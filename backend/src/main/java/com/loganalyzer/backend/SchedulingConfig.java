package com.loganalyzer.backend;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
public class SchedulingConfig {
    @Bean
    ThreadPoolTaskExecutor analysisExecutor(BackendProperties properties) {
        var executor=new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(properties.parallelism());
        executor.setMaxPoolSize(properties.parallelism());
        executor.setQueueCapacity(0);
        executor.setThreadNamePrefix("analysis-worker-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        return executor;
    }
    @Bean
    ThreadPoolTaskScheduler taskScheduler() {
        var scheduler=new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(2);
        scheduler.setThreadNamePrefix("analysis-scheduler-");
        return scheduler;
    }
}

