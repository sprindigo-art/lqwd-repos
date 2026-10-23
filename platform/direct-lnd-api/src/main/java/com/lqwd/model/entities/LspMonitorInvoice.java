package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.*;
import java.io.Serializable;
import java.util.Date;

@Entity
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class LspMonitorInvoice implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String userId;

    private String memo;

    private String value;

    private String valueMsat;

    private Boolean settled;

    private String creationDate;

    private String settleDate;

    private String paymentRequest;

    private String expiry;

    private String fallbackAddr;

    private String cltvExpiry;

    private Boolean isPrivate;

    private String addIndex;

    private String settleIndex;

    private String amtPaid;

    private String rhash;

    private String preImage;

    private String paymentAddr;

    private String amtPaidSat;

    private String amtPaidMsat;

    private String state;

    private Boolean isKeysend;

    private Boolean isAmp;

    //temp coluomn to save full json data. will use to know how to restructure table.
    private String fullJsonData;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date created;

    @Temporal(TemporalType.TIMESTAMP)
    private Date updated;

    private String nodeName;

    @PrePersist
    private void setCreatedDate() {
        created = new Date();
    }

    @PreUpdate
    private void setUpdatedDate() {
        updated = new Date();
    }

}
