package com.lqwd.security.oauth2.config.server;

import com.lqwd.security.oauth2.model.response.TokenUserDetail;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.common.DefaultOAuth2AccessToken;
import org.springframework.security.oauth2.common.OAuth2AccessToken;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.security.oauth2.provider.token.TokenEnhancer;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Used to add additional info to default oauth server tokens.
 */
public class Oauth2TokenEnhancer implements TokenEnhancer {

    @Autowired
    UserRepository userRepository;


    @Override
    public OAuth2AccessToken enhance(OAuth2AccessToken accessToken, OAuth2Authentication authentication) {
        final Map<String, Object> additionalInfo = new HashMap<>();

        User_ user = userRepository.findByUsernameOrEmail(authentication.getName(),
                authentication.getName()).orElse(null);
        if(null != user){
            additionalInfo.put("user_detail", new TokenUserDetail(user.getId().toString(),
                    user.getUserDetails().getFirstName(), user.getUserDetails().getFirstName(),
                    user.getAllowedNoOfLnd()));
        }

        List<String> roles = authentication.getAuthorities().stream().map((authority) -> authority.getAuthority()).collect(Collectors.toList());
        additionalInfo.put("roles", roles);


        ((DefaultOAuth2AccessToken) accessToken).setAdditionalInformation(additionalInfo);
        return accessToken;
    }
}
