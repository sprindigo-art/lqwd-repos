package com.lqwd.model;

import org.hibernate.validator.constraints.Length;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotEmpty;
import java.util.Set;

public class User {

    private String id;


    @Email(message = "*Please provide a valid Email")
    private String email;

    private String username;

    @Length(min = 5, message = "*Your password must have at least 5 characters")
    private String password;

    private String token;

    private String lastname;

    private String firstname;

    private int active;

    private String apikey;

    private boolean f2a;

    private String status;

    private Integer tokenexp;

    public Integer getTokenexp() {
        return tokenexp;
    }

    public String getUsernameOrEmail(){
        if(this.username == null){
            return this.email;
        }
        return username;
    }

    public String getUsername() {
          return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public void setTokenexp(Integer tokenexp) {
        this.tokenexp = tokenexp;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public boolean getF2a() {
        return f2a;
    }

    public void setF2a(boolean f2a) {
        this.f2a = f2a;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getApikey() {
        return apikey;
    }

    public void setApikey(String apikey) {
        this.apikey = apikey;
    }

    private Set<Role> roles;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getLastname() {
        return lastname;
    }

    public void setLastname(String lastname) {
        this.lastname = lastname;
    }

    public String getFirstname() {
        return firstname;
    }

    public void setFirstname(String firstname) {
        this.firstname = firstname;
    }

    public int getActive() {
        return active;
    }

    public void setActive(int active) {
        this.active = active;
    }

    public Set<Role> getRoles() {
        return roles;
    }

    public void setRoles(Set<Role> roles) {
        this.roles = roles;
    }
}
