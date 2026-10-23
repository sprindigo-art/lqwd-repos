package com.lqwd.model.request;

import java.util.HashMap;

public class UserSetting {

    private String email;
    private String username;

    private String protocol;

    private String firstname;

    private String lastname;

    private Boolean receivenews;

    private Boolean fa2 ;

    private String status;

    private String phone;

    private String serviceName;

    private String token;

    private Integer tokenexp;

    public HashMap<String, String> makeHashMap(){
        HashMap<String, String> parts = new HashMap<>();
        parts.put("username", this.username);
        parts.put("email", this.email);
        parts.put("protocol", this.protocol);
        parts.put("firstname", this.firstname);
        parts.put("lastname", this.lastname);
        if(this.receivenews != null) {
            parts.put("receivenews", this.receivenews.toString());
        }
        if(this.fa2 != null) {
            parts.put("fa2", this.fa2.toString());
        }
        parts.put("status", this.status);
        parts.put("phone", this.phone);

        parts.put("token", token);
        if(this.tokenexp != null) {
            parts.put("tokenexp", this.tokenexp.toString());
        } else {
            parts.put("tokenexp", "1000");
        }

        return parts;
    }

    public Integer getTokenexp() {
        return tokenexp;
    }

    public void setTokenexp(Integer tokenexp) {
        this.tokenexp = tokenexp;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getProtocol() {
        return protocol;
    }

    public void setProtocol(String protocol) {
        this.protocol = protocol;
    }

    public String getFirstname() {
        return firstname;
    }

    public void setFirstname(String firstname) {
        this.firstname = firstname;
    }

    public String getLastname() {
        return lastname;
    }

    public void setLastname(String lastname) {
        this.lastname = lastname;
    }

    public Boolean getReceivenews() {
        return receivenews;
    }

    public void setReceivenews(Boolean receivenews) {
        this.receivenews = receivenews;
    }

    public Boolean getFa2() {
        return fa2;
    }

    public void setFa2(Boolean fa2) {
        this.fa2 = fa2;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getServiceName() {
        return serviceName;
    }

    public void setServiceName(String serviceName) {
        this.serviceName = serviceName;
    }
}
