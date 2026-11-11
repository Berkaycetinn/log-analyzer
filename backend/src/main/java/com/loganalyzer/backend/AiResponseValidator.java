package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class AiResponseValidator {
    public void validate(JsonNode root) {
        try {
            object(root);
            text(root, "run_id");
            object(root.path("stats"));
            object(root.path("package"));
            object(root.path("report"));
            object(root.path("validation"));
            require(root.path("validation").path("valid").isBoolean());
            strings(root.path("validation").path("errors"));
            var ids = new HashSet<Integer>();
            for (JsonNode event : array(root.path("package").path("events"))) {
                require(event.path("event_id").canConvertToInt() && event.path("event_id").isIntegralNumber());
                int id = event.path("event_id").intValue();
                require(id >= 0 && ids.add(id));
                text(event, "start"); text(event, "end");
                require(event.path("n_rows").isIntegralNumber() && event.path("n_rows").canConvertToInt()
                    && event.path("n_rows").intValue() >= 0);
                array(event.path("templates"));
            }
            var reportIds = new HashSet<Integer>();
            for (JsonNode event : array(root.path("report").path("events"))) {
                require(event.path("event_id").isIntegralNumber() && event.path("event_id").canConvertToInt());
                require(reportIds.add(event.path("event_id").intValue()));
                require(Set.of("none", "low", "medium", "high").contains(text(event, "severity")));
                require(Set.of("low", "medium", "high").contains(text(event, "confidence")));
                text(event, "summary"); text(event, "confidence_reason");
                nullableText(event, "likely_root_cause"); nullableText(event, "recommended_fix");
                if (event.has("resolution_check")) nullableText(event, "resolution_check");
                for (String name : new String[]{"assumptions", "alternative_explanations",
                        "unknowns", "recommended_checks"}) { strings(event.path(name)); }
                for (JsonNode evidence : array(event.path("evidence"))) {
                    text(evidence, "time");
                    String quote = text(evidence, "quote");
                    require(!quote.isEmpty() && quote.codePointCount(0, quote.length()) <= 200);
                }
            }
            require(ids.equals(reportIds));
            text(root.path("report"), "cross_event_notes");
        } catch (IllegalArgumentException error) {
            throw new AiFailure("AI_INVALID_RESPONSE", "AI response violates the analysis contract", false, 200);
        }
    }
    private void nullableText(JsonNode node, String name) {
        require(node.has(name) && (node.get(name).isNull() || node.get(name).isTextual()));
    }
    private String text(JsonNode node, String name) {
        require(node.path(name).isTextual());
        return node.path(name).textValue();
    }
    private JsonNode array(JsonNode node) { require(node.isArray()); return node; }
    private void strings(JsonNode node) {
        for (JsonNode value : array(node)) { require(value.isTextual()); }
    }
    private void object(JsonNode node) { require(node != null && node.isObject()); }
    private void require(boolean valid) {
        if (!valid) throw new IllegalArgumentException("Invalid AI contract");
    }
}

