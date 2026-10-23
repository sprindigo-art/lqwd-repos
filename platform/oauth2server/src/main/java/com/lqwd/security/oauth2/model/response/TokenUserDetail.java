package com.lqwd.security.oauth2.model.response;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.io.Serializable;

@Data
@AllArgsConstructor
public class TokenUserDetail implements Serializable {

    private String userId;
    private String firstName;
    private String lastName;
    private int allowedNumberOfLnd;
}
