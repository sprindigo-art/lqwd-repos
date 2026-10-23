package com.lqwd.model.request;


import com.lqwd.model.enums.RestartAction;
import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

@Data
public class RestartLndRequest {

    private String passphrase;
    @NotBlank
    private String password;
    @NotNull
    private String lndname;

    private RestartAction action;


}
