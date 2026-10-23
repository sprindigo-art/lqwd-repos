package com.lqwd.model.request;

import lombok.Data;

@Data
public class RegistrationRequest {

    private String username;

    private String email;

    private String password;

    private String firstname;

    private String lastname;

    private String companyName;

    private String serviceName;

    private boolean f2a = true;

}
