package com.lqwd.security.oauth2.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class MfaService {

    private final String APP_NAME = "LQwD";

    public String generateQrURL(String mfaSecret, String userEmail) {
        return String.format(
                        "otpauth://totp/%s:%s?secret=%s&issuer=%s",
                        APP_NAME,
                        userEmail,
                        mfaSecret,
                        APP_NAME);
    }

}
