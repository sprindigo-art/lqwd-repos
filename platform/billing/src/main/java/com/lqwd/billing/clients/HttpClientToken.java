package com.lqwd.billing.clients;

import com.lqwd.billing.models.MainResponse;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.HttpPost;
import org.springframework.stereotype.Service;

import java.util.HashMap;


@Service
@RequiredArgsConstructor
public class HttpClientToken {



    private final  HttpClientUtility httpClientUtility;



    public MainResponse userInfo(String accessToken) {

        HashMap<String, String> parts = new HashMap<>();
        HttpPost postRequest = httpClientUtility.getHttpPost("/registration/userinfo", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, accessToken);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "UserInfo");

        return mainResponse;
    }



}
