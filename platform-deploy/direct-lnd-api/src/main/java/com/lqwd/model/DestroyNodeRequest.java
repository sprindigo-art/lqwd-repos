package com.lqwd.model;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class DestroyNodeRequest {
    private String nodeName;
    private String password;
    private String instanceId;
}
