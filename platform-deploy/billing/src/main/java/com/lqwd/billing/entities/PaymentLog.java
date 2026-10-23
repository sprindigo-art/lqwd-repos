package com.lqwd.billing.entities;

import com.lqwd.billing.enums.PaymentMethod;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.EnumType;
import javax.persistence.Enumerated;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.PrePersist;
import javax.persistence.PreUpdate;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.util.Date;

@Entity
@Setter
@Getter
public class PaymentLog {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    private String userId;
    private int confirmations;
    @Column(nullable = false, unique = true)
    private String identifier;
    private Boolean settled = Boolean.FALSE;
    @Column(columnDefinition = "TEXT")
    private String rawData;
    @Enumerated(value = EnumType.STRING)
    private PaymentMethod paymentMethod;
    private Long amount;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;

    @PrePersist
    private void beforeCreate() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }

}
