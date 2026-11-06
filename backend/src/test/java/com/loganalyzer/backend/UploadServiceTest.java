package com.loganalyzer.backend;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import static org.assertj.core.api.Assertions.*;
import static com.loganalyzer.backend.ApiModels.*;

class UploadServiceTest {
    static class CapturingStore extends JobStore {
        String filename, contentType, hash, key;
        byte[] bytes;
        CapturingStore() { super(null,null,null); }
        @Override public Job create(String filename,String contentType,byte[] bytes,String hash,String key) {
            this.filename=filename; this.contentType=contentType; this.bytes=bytes; this.hash=hash; this.key=key;
            return null;
        }
    }
    final CapturingStore store=new CapturingStore();
    final UploadService uploads=new UploadService(store,TestFixtures.properties(URI.create("http://localhost:8000"),8));
    @Test void storesUnmodifiedBytesAndBasename() throws Exception {
        byte[] data="hello\n".getBytes(StandardCharsets.UTF_8);
        uploads.submit(new MockMultipartFile("file","C:\\logs\\app.log","text/plain",data),"same-key");
        assertThat(store.filename).isEqualTo("app.log");
        assertThat(store.contentType).isEqualTo("text/plain");
        assertThat(store.bytes).isEqualTo(data);
        assertThat(store.hash).matches("[0-9a-f]{64}");
        assertThat(store.key).isEqualTo("same-key");
    }
    @Test void rejectsEmptyOrInvalidUtf8() {
        assertThatThrownBy(() -> uploads.submit(new MockMultipartFile("file",new byte[0]),null))
            .isInstanceOf(ApiFailure.class).extracting("status").isEqualTo(400);
        assertThatThrownBy(() -> uploads.submit(new MockMultipartFile("file","x.log","text/plain",new byte[]{(byte)255}),null))
            .isInstanceOf(ApiFailure.class).extracting("status").isEqualTo(400);
        assertThat(store.bytes).isNull();
    }
    @Test void doesNotTrustReportedMultipartSize() {
        var input=new MockMultipartFile("file","x.log","text/plain","123456789".getBytes()) {
            @Override public long getSize() { return 1; }
        };
        assertThatThrownBy(() -> uploads.submit(input,null)).isInstanceOf(ApiFailure.class)
            .extracting("status").isEqualTo(413);
        assertThat(store.bytes).isNull();
    }
    @Test void validatesIdempotencyKey() {
        assertThatThrownBy(() -> uploads.submit(new MockMultipartFile("file","x.log","text/plain","hello".getBytes()),"bad key"))
            .isInstanceOf(ApiFailure.class).extracting("status").isEqualTo(400);
    }
}

