package com.lqwd.model.request;

import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class OpenChannelRequest {
    private String passphrase;
    @NotBlank
    private String password;
    @NotBlank
    private String pubKey;
    @NotBlank
    private String nodeAddress;
    @NotBlank
    private String lndname;
    @NotBlank
    private String remoteAddress;
    private String satPerVByte;
    private boolean privateChannel;
    private int capacity;
}
