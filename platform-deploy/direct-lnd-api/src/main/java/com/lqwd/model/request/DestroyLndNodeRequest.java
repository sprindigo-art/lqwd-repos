package com.lqwd.model.request;

import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class DestroyLndNodeRequest {
    private String passphrase;
    private String password;
    @NotBlank
    private String lndname;
    private boolean force;
}
