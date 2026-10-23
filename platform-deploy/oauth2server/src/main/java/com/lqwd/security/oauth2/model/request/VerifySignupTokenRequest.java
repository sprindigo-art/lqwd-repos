package com.lqwd.security.oauth2.model.request;

import lombok.Data;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;

@Data
public class VerifySignupTokenRequest {
    @Email
    @NotBlank
    private String emailAddress;
    @NotBlank
    private String inviteCode;
}
