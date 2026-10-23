package com.lqwd.model.request;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class UnlockLndNodeRequest {

    @NotNull(message= "Passphrase is required")
    private String passphrase;

    @NotNull(message= "Nodename  is required")
    private String lndname;

    @JsonIgnore
    private String privateAddress;


}
