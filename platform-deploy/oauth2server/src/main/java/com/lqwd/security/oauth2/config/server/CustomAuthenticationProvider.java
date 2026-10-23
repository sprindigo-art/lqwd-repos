package com.lqwd.security.oauth2.config.server;

import com.lqwd.security.oauth2.interfaces.MfaTokenService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.oauth2.common.exceptions.InvalidGrantException;
import org.springframework.security.oauth2.common.exceptions.InvalidRequestException;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
public class CustomAuthenticationProvider extends DaoAuthenticationProvider {


    private MfaTokenService mfaTokenService;

    @Autowired
    public CustomAuthenticationProvider(UserDetailsService userDetailsService, MfaTokenService mfaTokenService) {
        super.setUserDetailsService(userDetailsService);
        this.mfaTokenService = mfaTokenService;
    }

    protected void additionalAuthenticationChecks(UserDetails userDetails,
                                                  UsernamePasswordAuthenticationToken authentication)
    throws AuthenticationException {

        super.additionalAuthenticationChecks(userDetails, authentication);

        if(authentication.getDetails() == null){
            return;
        }

        if (mfaTokenService.isEnabled(userDetails.getUsername())){

            Map<String, String> map = (Map<String,String>)authentication.getDetails();

            if (!map.containsKey("mfa_code"))
                throw new InvalidRequestException("Missing MFA code");

            String passcode = map.get("mfa_code");

            parseCode(passcode);

            if (!mfaTokenService.verifyCode(userDetails.getUsername(),passcode)) {
                throw new InvalidRequestException("Invalid MFA code");
            }


        }

    }

    private int parseCode(String codeString) {
        try {
            return Integer.parseInt(codeString);
        } catch (NumberFormatException e) {
            throw new InvalidGrantException("Invalid MFA code");
        }
    }
}

