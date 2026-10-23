package com.lqwd.security.oauth2.model.request;

import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class UpdateNodeInfoRequest {
    @NotBlank
    private String lndNodeName;
    private LNDNodeStatus status;
    private String pubKey;
    private String privateAddress;
    private String publicAddress;
    private String instanceId;
}
