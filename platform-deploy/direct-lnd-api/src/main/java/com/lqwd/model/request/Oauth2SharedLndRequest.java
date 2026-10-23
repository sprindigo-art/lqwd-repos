package com.lqwd.model.request;

import lombok.Data;

@Data
public class Oauth2SharedLndRequest {

    private String newUser_id;

    private String lndNode_id;

    private String role_id;
}
