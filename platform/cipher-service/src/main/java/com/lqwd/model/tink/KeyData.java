package com.lqwd.model.tink;

import lombok.Data;

@Data
public class KeyData{
    private String typeUrl;
    private String value;
    private String keyMaterialType;
}