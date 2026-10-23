package com.lqwd.security.oauth2.model.request;

import com.lqwd.security.oauth2.model.enums.DeploymentType;
import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import lombok.Data;

@Data
public class CreateNodeRequest {
    private String lndNodeName;
    private String network;
    private boolean routingNode;
    private boolean nonCustodial;
    private boolean confirmed;
    private LNDNodeStatus status;
    private DeploymentType deploymentType;
    private String watchtower;
    private String namespace;
    private String privateAddress;
    private String alias;
    private String externalIp;
    private boolean keySendEnabled;
    private String nodeId;

}
