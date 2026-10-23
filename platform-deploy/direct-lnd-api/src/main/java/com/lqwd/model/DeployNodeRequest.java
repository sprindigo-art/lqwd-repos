package com.lqwd.model;

import com.lqwd.model.enums.LndNetwork;
import lombok.Builder;
import lombok.Data;


@Data
@Builder
public class DeployNodeRequest {
    private Long nodeId;
    private String port;
    private String nodeName;
    private boolean watchTower;
    private LndNetwork lndNetwork;
    private String alias;
    private boolean nonCustodial;
    private String ownersEmail;
    private boolean routingNode;
    private boolean keySendEnabled;
    private boolean restoration;
    private String restoreNodeName;
    private String userId;
    private boolean torEnable;

}
