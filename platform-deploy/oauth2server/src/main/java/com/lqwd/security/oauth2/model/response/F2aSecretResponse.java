package com.lqwd.security.oauth2.model.response;

import javax.validation.constraints.Email;

public class F2aSecretResponse {

    @Email(message = "*Please provide a valid Email")
    private String email;

    private String secret;

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getSecret() {
        return secret;
    }

    public void setSecret(String secret) {
        this.secret = secret;
    }
}
