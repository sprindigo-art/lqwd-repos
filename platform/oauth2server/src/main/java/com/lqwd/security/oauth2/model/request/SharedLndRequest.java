package com.lqwd.security.oauth2.model.request;

import lombok.Data;

@Data
public class SharedLndRequest {

    private String newUser_id;

    private String lndNode_id;

    private String role_id;
}
