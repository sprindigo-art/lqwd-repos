package com.lqwd.model;


import lombok.Data;
import org.json.JSONObject;

@Data
public class BatchNodeInfo {
    private JSONObject info;
    private String node;
    private String userId;
    private Long timeStamp;
}
