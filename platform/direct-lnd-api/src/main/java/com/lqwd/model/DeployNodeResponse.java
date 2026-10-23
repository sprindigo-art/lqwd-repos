package com.lqwd.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeployNodeResponse {
    private String instanceId;
    private String privateAddress;
    private String publicAddress;
    private boolean success;
}
