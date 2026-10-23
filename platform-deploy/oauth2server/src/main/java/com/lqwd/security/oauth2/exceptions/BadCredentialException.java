package com.lqwd.security.oauth2.exceptions;

import org.springframework.security.oauth2.common.exceptions.OAuth2Exception;

public class BadCredentialException extends OAuth2Exception {

    public BadCredentialException(String message) {
        super(message);
    }

    public String getOAuth2ErrorCode() {
        return "Bad credentials";
    }

    public int getHttpErrorCode() {
        return 403;
    }
}