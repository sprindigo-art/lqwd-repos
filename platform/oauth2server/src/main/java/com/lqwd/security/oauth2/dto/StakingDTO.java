package com.lqwd.security.oauth2.dto;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;

@Data
public class StakingDTO implements Serializable {

    private Long id;
    private String userId;
    private String userEmail;
    private String userFirstname;
    private int days;
    private double amount;
    private Date created;
    private Date updated;
    private String status;
    private StakingDTO.StakingType stakingType;
    private Long stakingReference;
    private String nodeName;
    private Date paymentDate;



    public enum StakingType {
        BTCADDRESS,
        INVOICE
    }
}
