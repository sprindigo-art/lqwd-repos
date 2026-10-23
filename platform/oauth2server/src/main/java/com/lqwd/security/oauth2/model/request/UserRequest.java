package com.lqwd.security.oauth2.model.request;

import com.lqwd.security.oauth2.model.security.Role_;

import javax.persistence.Column;
import java.util.Collection;

public class UserRequest {
    private String username;

    private String email;

    private String password;
    private String token;
    private Collection<Role_> role_s;

    private String protocol;

    private String firstName;

    private String lastName;

    private Boolean receiveNews;

    private String firstname;

    private String lastname;

    private Boolean receivenews;

    private Boolean fa2;

    private String status;

    private String phone;

    private Integer tokenexp;


    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public Integer getTokenexp() {
        return tokenexp;
    }

    public void setTokenexp(Integer tokenexp) {
        this.tokenexp = tokenexp;
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

    public String getProtocol() {
        return protocol;
    }

    public void setProtocol(String protocol) {
        this.protocol = protocol;
    }

    public Boolean getReceiveNews() {
        return receiveNews;
    }

    public void setReceiveNews(Boolean receiveNews) {
        this.receiveNews = receiveNews;
    }

    public Boolean getFa2() {
        return fa2;
    }

    public void setFa2(Boolean fa2) {
        this.fa2 = fa2;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public Collection<Role_> getRole_s() {
        return role_s;
    }

    public void setRole_s(Collection<Role_> role_s) {
        this.role_s = role_s;
    }

    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = firstName;
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = lastName;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
