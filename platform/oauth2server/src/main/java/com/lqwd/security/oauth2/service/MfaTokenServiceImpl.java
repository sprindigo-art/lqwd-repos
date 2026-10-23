package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.interfaces.MfaTokenService;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.jboss.aerogear.security.otp.Totp;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class MfaTokenServiceImpl implements MfaTokenService {


    private final UserRepository userRepository;


    public boolean isEnabled(String username) {

        User_ user = userRepository.findByUsernameOrEmail(username, username).orElse(null);

        if (user == null){
            return false;
        }


        return user.getUserDetails().getFa2();

    }

    public boolean verifyCode(String username, String code) {
        User_ user = userRepository.findByUsernameOrEmail(username, username).orElse(null);

        if (user == null){
            return false;
        }

        Totp otp = new Totp(user.getF2asecret());

        return otp.verify(code);

    }
}
