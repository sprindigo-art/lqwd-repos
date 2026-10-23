package com.lqwd.billing.models;


import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class NodeInfoResponse {
    private String address;
    private String pubKey;
}
