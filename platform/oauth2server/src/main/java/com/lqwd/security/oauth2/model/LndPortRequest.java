package com.lqwd.security.oauth2.model;

import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class LndPortRequest {
    @NotBlank
    private String portRange;

    @NotBlank
    private String btcHost;

    @NotBlank
    private String lndIp;
}
