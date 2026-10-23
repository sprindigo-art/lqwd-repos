package com.lqwd.model.request;

import lombok.Builder;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
@Builder
public class SetSecretRequest {

    @NotBlank
    private String namespace;

    @NotBlank
    private String secretName;

    @NotBlank
    private String secretKey;

    @NotBlank
    private String secretValue;
}
