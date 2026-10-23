package com.lqwd.httpclient;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;

public class CheckTokenResponse {

    private String[] aud;

    private String active;

    private Integer exp;

    private String user_name;

    private String client_id;

    private String[] scope;

    private String[] authorities;

    public String[] getAud() {
        return aud;
    }

    public void setAud(String[] aud) {
        this.aud = aud;
    }

    public String getActive() {
        return active;
    }

    public void setActive(String active) {
        this.active = active;
    }

    public Integer getExp() {
        return exp;
    }

    public void setExp(Integer exp) {
        this.exp = exp;
    }

    public String getUser_name() {
        return user_name;
    }

    public void setUser_name(String user_name) {
        this.user_name = user_name;
    }

    public String getClient_id() {
        return client_id;
    }

    public void setClient_id(String client_id) {
        this.client_id = client_id;
    }

    public String[] getScope() {
        return scope;
    }

    public void setScope(String[] scope) {
        this.scope = scope;
    }

    public String[] getAuthorities() {
        return authorities;
    }

    public void setAuthorities(String[] authorities) {
        this.authorities = authorities;
    }

    public CheckTokenResponse mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        CheckTokenResponse checkTokenResponse = new CheckTokenResponse();
        try {
            checkTokenResponse = (CheckTokenResponse) mapper.readValue(content, CheckTokenResponse.class);

        } catch (IOException e) {
            e.printStackTrace();
        }
        return checkTokenResponse;
    }

    public boolean checkExpires_in(Long timeNowInSec) {
        if ((timeNowInSec - this.exp) > (this.exp - 10)) {
            return false;
        } else {
            return true;
        }

    }

    public boolean isValid() {
        if (this.active == null) {
            return false;
        }
        if (this.exp == null) {
            return false;
        }
        Long timeNowInSec = System.currentTimeMillis() / 1000;
        if (timeNowInSec - this.exp >= 0) {
            return false;
        }
        return true;
    }
}
