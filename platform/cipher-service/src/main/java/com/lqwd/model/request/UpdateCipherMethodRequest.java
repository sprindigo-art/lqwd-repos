package com.lqwd.model.request;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.util.List;

@Data
public class UpdateCipherMethodRequest {

    @NotBlank(message="cipher method is required")
    @NotNull(message="cipher method is required")
    private String methodName;

    private boolean selectAll;

    private List<Long> files;

}
