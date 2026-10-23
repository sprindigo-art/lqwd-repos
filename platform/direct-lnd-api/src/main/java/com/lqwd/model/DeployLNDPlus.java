package com.lqwd.model;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class DeployLNDPlus {

    private String nodeName;
    private String accessToken;
    private String network;
    private int nodeId;

}
