package com.lqwd.model.request;

import lombok.Builder;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
@Builder
public class UpdateKeyRequest {

    @NotBlank
    private String newKey;
}
