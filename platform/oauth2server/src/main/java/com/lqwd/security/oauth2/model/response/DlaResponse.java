package com.lqwd.security.oauth2.model.response;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class DlaResponse {
    private int status;
    private String message;
    private String data;
}
