package com.lqwd.model.request;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.validators.NonNullFieldWhenOtherFieldHasCertainValue;
import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class ConnectLndPeerRequest {

    @NotNull
    private String peerPubKey;

    @NotNull
    private String peerHost;

    private Integer peerPort = 9735;

}
