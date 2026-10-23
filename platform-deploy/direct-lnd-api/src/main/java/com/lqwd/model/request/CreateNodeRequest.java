package com.lqwd.model.request;

import com.lqwd.model.enums.DeploymentType;
import lombok.Data;

@Data
public class CreateNodeRequest {
    private String lndNodeName;
    private String network;
    private boolean routingNode;
    private boolean nonCustodial;
    private boolean confirmed;
    private String status;
    private DeploymentType deploymentType;
    private String watchtower;
    private String namespace;
    private String privateAddress;
    private String alias;
    private String externalIp;
    private boolean keySendEnabled;
    private String nodeId;
}