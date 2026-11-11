package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class AiResponseValidatorTest {
    private final AiResponseValidator validator=new AiResponseValidator();
    @Test void acceptsActualFastApiContract() { validator.validate(TestFixtures.response()); }
    @Test void acceptsResolutionCheckAndRejectsMalformedVerification() {
        var value=TestFixtures.response();
        var event=(ObjectNode)value.path("report").path("events").get(0);
        event.put("resolution_check","İşi yeniden çalıştırın; hata tekrarlamamalıdır.");
        assertThatCode(() -> validator.validate(value)).doesNotThrowAnyException();
        event.put("resolution_check",true);
        assertThatThrownBy(() -> validator.validate(value)).isInstanceOf(AiFailure.class);
    }
    @Test void retainsUnverifiedResultsAsWarningsRatherThanInventingValidity() {
        var value=(ObjectNode)TestFixtures.response();
        ((ObjectNode)value.path("validation")).put("valid",false);
        ((ArrayNode)value.path("validation").path("errors")).add("quote mismatch");
        assertThatCode(() -> validator.validate(value)).doesNotThrowAnyException();
    }
    @Test void rejectsMismatchedIds() {
        var value=TestFixtures.response();
        ((ObjectNode)value.path("report").path("events").get(0)).put("event_id",20);
        assertThatThrownBy(() -> validator.validate(value)).isInstanceOf(AiFailure.class);
    }
    @Test void rejectsDuplicateIds() {
        var value=TestFixtures.response();
        ((ArrayNode)value.path("report").path("events")).add(value.path("report").path("events").get(0).deepCopy());
        assertThatThrownBy(() -> validator.validate(value)).isInstanceOf(AiFailure.class);
    }
    @Test void rejectsInvalidEnumsAndOversizedQuotes() {
        var value=TestFixtures.response();
        ((ObjectNode)value.path("report").path("events").get(0)).put("severity","critical");
        assertThatThrownBy(() -> validator.validate(value)).isInstanceOf(AiFailure.class);
        var other=TestFixtures.response();
        ((ObjectNode)other.path("report").path("events").get(0).path("evidence").get(0)).put("quote","a".repeat(201));
        assertThatThrownBy(() -> validator.validate(other)).isInstanceOf(AiFailure.class);
    }
    @Test void rejectsMalformedEnvelope() {
        var value=(ObjectNode)TestFixtures.response();
        value.remove("package");
        assertThatThrownBy(() -> validator.validate(value)).isInstanceOf(AiFailure.class);
    }
}

