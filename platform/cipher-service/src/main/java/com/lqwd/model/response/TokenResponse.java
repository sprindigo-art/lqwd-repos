package com.lqwd.model.response;

import lombok.Data;

import java.util.List;

@Data
public class TokenResponse {

    String access_token;
    String token_type;
    String refresh_token;
    long expires_in;
    String  scope;
    List<String> roles;

}

