package com.lqwd.model.request;

import com.lqwd.validators.ValidSaveLndFileRequest;
import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@ValidSaveLndFileRequest
@Builder
public class SaveLndFileRequest {

    private String nodeName;

    private String network;

    private String domain;

    private String pubkey;

    private Boolean watchtower;

    private String rpchost;

    private String status;

    private String key;

    private String rpcpass;

    private String rpcuser;

    private List<LndFileItem> files;

    private String password;

}
