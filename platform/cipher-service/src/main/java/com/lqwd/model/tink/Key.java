package com.lqwd.model.tink;

import lombok.Data;

@Data
public class Key{
    private KeyData keyData;
    private String status;
    private int keyId;
    private String outputPrefixType;
}