package com.lqwd.service;

import com.lqwd.exception.ApplicationRequestException;
import com.lqwd.interfaces.IOauthClient;
import com.lqwd.model.response.TokenResponse;
import com.lqwd.model.response.UserResponse;
import org.apache.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import retrofit2.Call;
import retrofit2.Response;

import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

@Service
public class OauthService {

    @Autowired
    IOauthClient oauthClient;

    @Value("${app.auth_user_name}")
    String appUsername;

    @Value("${app.auth_password}")
    String appPassword;

    @Autowired
    HttpServletRequest request;

    public TokenResponse login(String username, String password){
        String authorization = "Basic " + Base64.getEncoder().encodeToString((appUsername+":"+appPassword).getBytes());
        Call<TokenResponse> retrofitCall = oauthClient.getToken(authorization, username, password, "password","read");
        try{
            Response<TokenResponse> response = retrofitCall.execute();
            return response.body();
        }catch(IOException ex){
            throw new ApplicationRequestException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        }
    }


    public TokenResponse getClientToken(){
        String authorization = "Basic " + Base64.getEncoder().encodeToString((appUsername+":"+appPassword).getBytes());
        Call<TokenResponse> retrofitCall = oauthClient.getClientToken(authorization, "client_credentials");
        try{
            Response<TokenResponse> response = retrofitCall.execute();
            return response.body();
        }catch(IOException ex){
            throw new ApplicationRequestException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        }
    }

    public void setNodeStatusAsRunning(String nodeName, String pubKey){
        String authorization = request.getHeader("Authorization");
        try{
            oauthClient.updateNodeInfo(authorization,
                    pubKey,
                    nodeName,
                    "RUNNING").execute();
        }catch(IOException ex){
            throw new ApplicationRequestException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        }

    }


    public String getUserId(){
        String authorization = request.getHeader("Authorization");
        Call<UserResponse> retrofitCall = oauthClient.getUserInfo(authorization);
        try{
            Response<UserResponse> response = retrofitCall.execute();
            return response.body().getId();
        }catch(IOException ex){
            throw new ApplicationRequestException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        }
    }


}
