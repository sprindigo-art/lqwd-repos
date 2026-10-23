package com.lqwd.model.response;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;

public class ApikeyResponse {


    private  String apikey;

    public ApikeyResponse(){}

    public ApikeyResponse(String apikey) {
        this.apikey = apikey;
    }

    public String getApikey() {
        return apikey;
    }

    public ApikeyResponse mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper();
        ApikeyResponse apikeyResponse = new ApikeyResponse();
        try {
            apikeyResponse = (ApikeyResponse) mapper.readValue(content, ApikeyResponse.class);

        } catch (IOException e) {
            e.printStackTrace();
        }
        return apikeyResponse;
    }

    public boolean isValid() {
        if(this.apikey != null && this.apikey.equals("OK")) return true;
        return false;
    }
}
