package com.lqwd.model.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Builder
@Data
public class CipherMethodResponse {

    private String methodName;
    private String secretKey;
    private boolean isDefault;


}
