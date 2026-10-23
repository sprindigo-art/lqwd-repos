package com.lqwd.model.request;

import com.lqwd.validators.ValidEncryptRequest;
import lombok.Builder;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
@Builder
public class SetPasswordRequest {

    @NotBlank
    private String nodeName;

    private String newPassword;
    @NotBlank
    private String oldPassword;
}
