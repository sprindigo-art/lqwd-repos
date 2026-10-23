package com.lqwd.security.oauth2.model.response;


import com.lqwd.security.oauth2.model.security.AccountInfo;

public class AccountInfoResponse {


    private String status;

    private String plan;

    private String name;

    private String description;

    public AccountInfoResponse(){}

    public AccountInfoResponse(AccountInfo accountInfo){

        this.status = accountInfo.getStatus();
        this.plan = accountInfo.getPlan();
        if(accountInfo.getAccountType() != null) {
            this.name = accountInfo.getAccountType().getName();
            this.description = accountInfo.getAccountType().getDescription();
        } else {
            this.name = "employee";
            this.description = "LQWD employee";
        }

    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getPlan() {
        return plan;
    }

    public void setPlan(String plan) {
        this.plan = plan;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
}
