package com.lqwd.security.oauth2.model.response;

import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.model.security.User_Details;
import lombok.Data;

import java.io.Serializable;
import java.util.Collection;
import java.util.stream.Collectors;

@Data
public class UserResponse implements Serializable {
    private String id;
    private  String token;
    private  String username;
    private String email;
    private  Collection<String> role_s;
    private String firstName;
    private String lastName;

    private String mfaSecret;

    private Boolean receiveNews;

    private double liquidityFee;

    private Boolean fa2;

    private Boolean emailstatus;

    private String phone;

    private Integer tokenexp;

    private String mfaUrl;


    public UserResponse(String token,  User_ user) {
        this.token = token;
        this.username = user.getUsername();
        this.id = user.getId().toString();
        this.role_s = user.getRole_s().stream().map((role_) -> role_.getName()).distinct().collect(Collectors.toList());
        this.liquidityFee = user.getLiquidityFee() == null ?0:user.getLiquidityFee();
        this.mfaSecret = user.getF2asecret();

    }

    public UserResponse( User_ user, String mfaUrl) {
        this(user);
        this.mfaUrl = mfaUrl;
    }

    public UserResponse (User_ user){

        User_Details user_details = user.getUserDetails();
        this.id = user.getId().toString();
        this.username = user.getUsername();
        this.email = user.getEmail();
        this.mfaSecret = user.getF2asecret();
        if(user.getStatus() != null && user.getStatus().equals("CONFIRM")){
            this.emailstatus = true;
        } else {
            this.emailstatus = false;
        }
        if(user.getTokenexp() != null){
            this.tokenexp = user.getTokenexp();
        } else {
            this.tokenexp = 0;
        }
        if(user_details != null) {
            this.firstName = user_details.getFirstName();
            this.lastName = user_details.getLastName();
            this.receiveNews = user_details.getReceiveNews();
            this.fa2 = user_details.getFa2();
            this.phone = user_details.getPhone();
        }
        this.liquidityFee = user.getLiquidityFee() == null ?0:user.getLiquidityFee();

        if(user.getRole_s() != null){
            role_s = user.getRole_s().stream().map((role_) -> role_.getName()).distinct().collect(Collectors.toList());
        }

    }

}


