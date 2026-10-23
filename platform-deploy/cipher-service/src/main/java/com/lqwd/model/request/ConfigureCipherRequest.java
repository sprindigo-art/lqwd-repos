package com.lqwd.model.request;

import lombok.Data;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

@Data
public class ConfigureCipherRequest {

    @NotBlank(message="cipher method is required")
    private String methodName;

    @NotBlank(message="Secret key is required")
    private String secretKey;

    private Boolean isDefault;
}
