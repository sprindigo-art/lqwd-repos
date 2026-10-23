package com.lqwd.breez.dto.response;



import lombok.Data;

import java.util.Date;

@Data
public class ApikeyResponse {


    private  String apikey;

    private Date created;

    private String status;

    private String accountplan;

    private String accountstatus;

    private String lndnodename;

    private String lndNodeName;

    private String externalip;

    private String description;

    private String port;

    private String namespace;

    public ApikeyResponse(String apikey) {
        this.apikey = apikey;
    }
    public ApikeyResponse() {}

}
