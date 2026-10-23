package com.lqwd.model.request;

import com.lqwd.validators.ValidEncryptRequest;
import lombok.Builder;
import lombok.Data;

@Data
@ValidEncryptRequest
@Builder
public class EncryptRequest {
    private String input;
    private String method;
    private String password;
}
