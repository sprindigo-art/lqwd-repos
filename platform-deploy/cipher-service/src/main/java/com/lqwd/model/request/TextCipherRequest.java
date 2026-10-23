package com.lqwd.model.request;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

@Data
public class TextCipherRequest {

    @NotBlank(message="cipher method is required")
    @NotNull(message="cipher method is required")
    private String methodName;


    @NotBlank(message="Secret key is required")
    @NotNull(message="Secret key is required")
    private String secretKey;

    @NotBlank(message="text required")
    @NotNull(message="text is required")
    private String text;
}
