package com.loganalyzer.backend;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.*;
import java.util.HexFormat;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import static com.loganalyzer.backend.ApiModels.*;

@Service
public class UploadService {
    private final JobStore store;
    private final BackendProperties properties;
    public UploadService(JobStore store, BackendProperties properties) {
        this.store=store; this.properties=properties;
    }
    public Job submit(MultipartFile file, String key) throws IOException {
        if (file.isEmpty()) throw new ApiFailure(400,"EMPTY_UPLOAD","Log file is empty");
        if (file.getSize()>properties.maxUploadBytes()) throw new ApiFailure(413,"UPLOAD_TOO_LARGE","Log file exceeds size limit");
        if (key != null && !key.matches("[A-Za-z0-9._:-]{1,128}")) {
            throw new ApiFailure(400,"INVALID_IDEMPOTENCY_KEY","Idempotency key must contain 1-128 ASCII letters, digits, . _ : or -");
        }
        String filename = file.getOriginalFilename();
        if (filename == null) filename="upload.log";
        filename=filename.replace('\\','/');
        filename=filename.substring(filename.lastIndexOf('/')+1);
        if (filename.isBlank() || filename.length()>255 || filename.chars().anyMatch(Character::isISOControl)) {
            throw new ApiFailure(400,"INVALID_FILENAME","Invalid upload filename");
        }
        // Bound the actual read too; do not trust multipart metadata.
        byte[] data;
        try (var input=file.getInputStream()) {
            data=input.readNBytes((int)properties.maxUploadBytes()+1);
        }
        if (data.length==0) throw new ApiFailure(400,"EMPTY_UPLOAD","Log file is empty");
        if (data.length>properties.maxUploadBytes()) throw new ApiFailure(413,"UPLOAD_TOO_LARGE","Log file exceeds size limit");
        try {
            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(data));
        } catch (CharacterCodingException error) {
            throw new ApiFailure(400,"INVALID_ENCODING","Log file must be UTF-8");
        }
        String contentType=file.getContentType()==null ? "application/octet-stream" : file.getContentType();
        if (contentType.length()>128) throw new ApiFailure(400,"INVALID_CONTENT_TYPE","Content type is too long");
        try {
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
            return store.create(filename,contentType,data,hash,key);
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}

