package com.lqwd.service;

import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.response.MainResponse;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.security.oauth2.provider.authentication.OAuth2AuthenticationDetails;
import org.springframework.stereotype.Service;

import java.io.IOException;

@Service
@RequiredArgsConstructor
public class AccessTokenServiceHelper {


    private final HttpClientToken httpClientToken;

    public String getAccessTokenFromAuthentication(OAuth2Authentication authentication){
        if(authentication == null)
            return null;
        OAuth2AuthenticationDetails details = (OAuth2AuthenticationDetails) authentication.getDetails();
        return details.getTokenValue();
    }


    public String  getClientAccessToken(){
        try {
            MainResponse mainResponse = httpClientToken.getClientToken();
            if (mainResponse.getStatus() == 200) {
                JSONObject jsonObject = new JSONObject(mainResponse.getObject());
                String accessToken = jsonObject.getString("access_token");
                return accessToken;
            }else{
                return null;
            }
        } catch (IOException | JSONException e) {
            return null;
        }

    }
}
