package com.loganalyzer.backend;

import jakarta.validation.ConstraintViolationException;
import org.slf4j.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.*;
import org.springframework.web.method.annotation.*;
import org.springframework.web.multipart.*;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log=LoggerFactory.getLogger(ApiExceptionHandler.class);
    @ExceptionHandler(ApiFailure.class)
    public ResponseEntity<ProblemDetail> domain(ApiFailure error) {
        ProblemDetail body=ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(error.status()),error.getMessage());
        body.setProperty("code",error.code());
        ResponseEntity.BodyBuilder response=ResponseEntity.status(error.status());
        if (error.status()==429) response.header("Retry-After","5");
        return response.body(body);
    }
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ProblemDetail> size(Exception error) {
        return domain(new ApiFailure(413,"UPLOAD_TOO_LARGE","Upload exceeds request size limit"));
    }
    @ExceptionHandler({ConstraintViolationException.class,MethodArgumentTypeMismatchException.class,
        MissingServletRequestPartException.class,MissingServletRequestParameterException.class,
        MethodArgumentNotValidException.class,HandlerMethodValidationException.class})
    public ResponseEntity<ProblemDetail> invalid(Exception error) {
        return domain(new ApiFailure(400,"INVALID_REQUEST","Invalid request parameters"));
    }
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> unexpected(Exception error) {
        log.error("Request failed",error);
        return domain(new ApiFailure(500,"INTERNAL_ERROR","Request failed"));
    }
}

