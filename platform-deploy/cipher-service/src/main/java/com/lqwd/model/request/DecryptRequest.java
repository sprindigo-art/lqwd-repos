package com.lqwd.model.request;

import com.lqwd.validators.ValidDecryptRequest;
import lombok.Builder;
import lombok.Data;

@Data
@ValidDecryptRequest
@Builder
public class DecryptRequest {

    private Long fileId;
    private String requestType;
    private String input;
    private String method;

    private String fileName;
    private String nodeName;

    private String password;

    public static enum CipherRequestType {
        INTERNAL_FILE_ID,
        INTERNAL_FILE_NAME_AND_NODE,
        EXTERNAL
    }
}
