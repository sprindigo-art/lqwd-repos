package com.lqwd.security.oauth2.config;

public class ApiException extends  Exception{
    int status;

    public ApiException(int status, String error) {
        super(error);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}
