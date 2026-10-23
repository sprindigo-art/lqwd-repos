package com.lqwd.security.oauth2.interfaces;

public interface MfaTokenService {

    boolean isEnabled(String username);

    boolean verifyCode(String username, String code);
}