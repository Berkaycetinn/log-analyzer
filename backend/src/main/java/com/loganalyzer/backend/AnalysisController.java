package com.loganalyzer.backend;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.net.URI;
import java.util.*;
import org.springframework.http.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import static com.loganalyzer.backend.ApiModels.*;

@RestController
@RequestMapping("/api/v1/analyses")
@Validated
public class AnalysisController {
    private final JobStore store;
    private final UploadService uploads;
    public AnalysisController(JobStore store,UploadService uploads) {
        this.store=store; this.uploads=uploads;
    }
    @PostMapping(consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Job> submit(@RequestPart("file") MultipartFile file,
            @RequestHeader(value="Idempotency-Key",required=false) String key) throws IOException {
        Job job=uploads.submit(file,key);
        return ResponseEntity.accepted().location(URI.create("/api/v1/analyses/"+job.id())).body(job);
    }
    @GetMapping
    public Page<Job> list(@RequestParam(required=false) JobStatus status,
            @RequestParam(defaultValue="0") @Min(0) int page,
            @RequestParam(defaultValue="20") @Min(1) @Max(100) int size) {
        return store.list(status,page,size);
    }
    @GetMapping("/{id}") public Job get(@PathVariable UUID id) { return store.get(id); }
    @GetMapping("/{id}/result") public JsonNode result(@PathVariable UUID id) { return store.result(id); }
    @GetMapping("/{id}/events")
    public Page<Event> events(@PathVariable UUID id,@RequestParam(defaultValue="0") @Min(0) int page,
            @RequestParam(defaultValue="20") @Min(1) @Max(100) int size) {
        return store.events(id,page,size);
    }
    @GetMapping("/{id}/events/{eventId}")
    public Event event(@PathVariable UUID id,@PathVariable @Min(0) int eventId) {
        return store.event(id,eventId);
    }
    @GetMapping("/{id}/attempts") public List<Attempt> attempts(@PathVariable UUID id) { return store.attempts(id); }
    @PostMapping("/{id}/retry")
    public ResponseEntity<Job> retry(@PathVariable UUID id) {
        return ResponseEntity.accepted().location(URI.create("/api/v1/analyses/"+id)).body(store.retry(id));
    }
    @PostMapping("/{id}/cancel") public Job cancel(@PathVariable UUID id) { return store.cancel(id); }
    @DeleteMapping("/{id}") public ResponseEntity<Void> delete(@PathVariable UUID id) {
        store.delete(id); return ResponseEntity.noContent().build();
    }
}

