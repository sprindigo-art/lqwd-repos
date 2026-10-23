package com.lqwd.security.oauth2.model.request;

import lombok.Builder;
import lombok.Data;

import javax.validation.constraints.NotBlank;


@Data
public class RegistrationRequest {

    @NotBlank
    private String username;
    @NotBlank
    private String email;
    @NotBlank
    private String password;
    private String firstname;
    private String lastname;
    private String companyName;
    private String serviceName;
    private Boolean f2a = true;

}
