package com.lqwd.breez.service;

import com.lqwd.breez.exceptions.ApiException;
import com.lqwd.breez.httpclient.IOauthClient;
import org.apache.http.HttpStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Service;
import retrofit2.Call;
import retrofit2.Response;

import java.io.IOException;

@Service
public class OauthServerApiService {

    private static Logger logger = LoggerFactory.getLogger(OauthServerApiService.class);

    @Autowired
    IOauthClient oauthClient;


    public void authorizeViaApiKey(String apiKey) throws ApiException {
        Call<String> retrofitCall =  oauthClient.authorizeViaApiKey(apiKey );
        try{
            Response<String> response = retrofitCall.execute();
            System.out.println(response.body());
        }catch(IOException ex){
             throw new ApiException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        }
    }

}
