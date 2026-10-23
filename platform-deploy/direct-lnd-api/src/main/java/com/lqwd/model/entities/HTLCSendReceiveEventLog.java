package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.PrePersist;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.io.Serializable;
import java.util.Date;

@Entity
@Builder
@Data
@NoArgsConstructor
@AllArgsConstructor
public class HTLCSendReceiveEventLog implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    private String userId;
    private Integer outgoingAmtMsat;
    private Integer incomingAmtMsat;
    private Integer feeMsat;
    private Long timestampNs;
    private String incomingChannelId;
    private String outgoingChannelId;
    private String incomingHtlcId;
    private String outgoingHtlcId;
    private Long incomingTimeLock;
    private Long outgoingTimeLock;
    private String preImage;
    @Column(nullable = false)
    private String eventType;
    @Column(nullable = false)
    private String nodeName;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;



    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }



}