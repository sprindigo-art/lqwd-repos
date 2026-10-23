package com.lqwd.security.oauth2.model.response;


import com.lqwd.security.oauth2.model.security.ApiKey;

import java.util.Date;

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

    public ApikeyResponse(){}

    public ApikeyResponse(ApiKey apiKey){
        this.apikey = apiKey.getApikey();
        this.status = apiKey.getStatus();
        this.created = apiKey.getCreated();

    }

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }

    public ApikeyResponse(String apikey) {
        this.apikey = apikey;
    }


    public String getApikey() {
        return apikey;
    }

    public void setApikey(String apikey) {
        this.apikey = apikey;
    }

    public Date getCreated() {
        return created;
    }

    public void setCreated(Date created) {
        this.created = created;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getAccountplan() {
        return accountplan;
    }

    public void setAccountplan(String accountplan) {
        this.accountplan = accountplan;
    }

    public String getAccountstatus() {
        return accountstatus;
    }

    public void setAccountstatus(String accountstatus) {
        this.accountstatus = accountstatus;
    }

    public String getLndnodename() {
        return lndnodename;
    }

    public void setLndnodename(String lndnodename) {
        this.lndnodename = lndnodename;
    }

    public String getExternalip() {
        return externalip;
    }

    public void setExternalip(String externalip) {
        this.externalip = externalip;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getPort() {
        return port;
    }

    public void setPort(String port) {
        this.port = port;
    }



    public String getLndNodeName() {
        return lndNodeName;
    }

    public void setLndNodeName(String lndNodeName) {
        this.lndNodeName = lndNodeName;
    }
}
