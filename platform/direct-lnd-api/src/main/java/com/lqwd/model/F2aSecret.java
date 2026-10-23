package com.lqwd.model;

import org.hibernate.validator.constraints.Length;

import javax.validation.constraints.Email;

public class F2aSecret {

    @Email(message = "*Please provide a valid Email")
    private String email;

    private String f2asecret;

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getF2asecret() {
        return f2asecret;
    }

    public void setF2asecret(String f2asecret) {
        this.f2asecret = f2asecret;
    }
}
