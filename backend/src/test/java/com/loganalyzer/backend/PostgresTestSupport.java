package com.loganalyzer.backend;

import java.net.URI;
import org.springframework.test.context.DynamicPropertyRegistry;

abstract class PostgresTestSupport {
    static void database(DynamicPropertyRegistry registry) {
        String url=System.getenv("BACKEND_TEST_DB_URL");
        if (url==null || !URI.create(url.substring("jdbc:".length())).getPath().endsWith("_test")) {
            throw new IllegalStateException("BACKEND_TEST_DB_URL must explicitly point to a disposable database ending in _test");
        }
        registry.add("spring.datasource.url",() -> url);
        registry.add("spring.datasource.username",() -> System.getenv().getOrDefault("BACKEND_TEST_DB_USERNAME","backend_test"));
        registry.add("spring.datasource.password",() -> System.getenv().getOrDefault("BACKEND_TEST_DB_PASSWORD",""));
    }
}

