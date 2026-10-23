package com.lqwd.model.response;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lqwd.model.Role;

import java.io.IOException;
import java.util.Collection;

public class UserResponse {

    private String token;

    private String username;

    private Collection<Role> roles;

    public UserResponse(String token, String username, Collection<Role> roles) {
        this.token = token;
        this.username = username;
        this.roles = roles;
    }

    public UserResponse(){}

    public String getToken() {
        return token;
    }

    public String getUsername() {
        return username;
    }

    public Collection<Role> getRole_s() {
        return roles;
    }

    public UserResponse mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper();
        UserResponse userResponse = new UserResponse();
        try {
            userResponse = (UserResponse) mapper.readValue(content, UserResponse.class);

        } catch (IOException e) {
            e.printStackTrace();
        }
        return userResponse;
    }
}
