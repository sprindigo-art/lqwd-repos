package com.lqwd.model.response;

import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class GenerateKeyResponse {
    private String secretKey;
}
