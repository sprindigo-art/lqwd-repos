package com.lqwd.model.entities;

import com.lqwd.model.enums.LiquidityType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.EnumType;
import javax.persistence.Enumerated;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.PrePersist;
import javax.persistence.PreUpdate;
import javax.persistence.Table;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import javax.persistence.UniqueConstraint;
import java.io.Serializable;
import java.util.Date;

@Entity
@Builder
@Data
@NoArgsConstructor
@AllArgsConstructor
@Table(
        uniqueConstraints=
        @UniqueConstraint(columnNames={"paymentOptionId", "type"})
)
public class Liquidity implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    private Integer amt;
    private Integer requestedAmt;
    private Integer fee;
    private Integer feeToPay;
    private Integer estimatedChannelFee;
    private Double feePercentage;
    @Column(nullable = false)
    private String userId;
    @Column(nullable = false)
    private String userEmail;
    //invoice id or btcAddressId
    private Long paymentOptionId;
    private Long channelId;
    private Boolean paid = false;
    @Column(nullable = false, columnDefinition = "TEXT")
    private String pubkey;
    @Column(nullable = false)
    private String ipAddress;
    private Integer durationInWeeks;
    @Column(columnDefinition = "TEXT")
    private String error;
    @Enumerated(value = EnumType.STRING)
    private LiquidityType type;
    @Temporal(TemporalType.TIMESTAMP)
    private Date channelExpiryDate;
    private Boolean expired = false;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;



    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }


}