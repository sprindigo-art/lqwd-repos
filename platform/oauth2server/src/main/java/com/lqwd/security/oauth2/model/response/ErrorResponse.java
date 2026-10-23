package com.lqwd.security.oauth2.model.response;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Builder
public class ErrorResponse {

    private boolean error;

    private String message;

}
