package com.lqwd.security.oauth2.dto;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;


@Data
public class LiquidityDTO implements Serializable {

    private Long id;
    private Integer amt;
    private Integer requestedAmt;
    private Integer fee;
    private Integer feeToPay;
    private Double feePercentage;
    private String userId;
    private String userEmail;
    private Long paymentOptionId;
    private Long channelId;
    private Boolean paid = false;
    private String pubkey;
    private String ipAddress;
    private Integer durationInWeeks;
    private String error;
    private String type;
    private Date channelExpiryDate;
    private Boolean expired ;
    private Date dateCreated;
    private Date dateModified;

}