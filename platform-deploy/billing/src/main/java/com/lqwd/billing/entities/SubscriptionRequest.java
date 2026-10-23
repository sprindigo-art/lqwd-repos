package com.lqwd.billing.entities;

import com.lqwd.billing.enums.PaymentMethod;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.Where;

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
@SQLDelete(sql = "UPDATE subscription_request SET deleted_at = current_timestamp WHERE id=?")
@Where(clause = "deleted_at is NULL")
public class SubscriptionRequest {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    @Column(nullable = false)
    private Long planId;
    private Long discountId;
    @Column(nullable = false)
    private Long productId;
    @Column(nullable = false)
    private String userId;
    @Column(nullable = false)
    private String lndInvoiceId;
    @Column(nullable = false)
    private String firstName;
    @Column(nullable = false)
    private String lastName;
    @Column(nullable = false)
    private String email;
    private String node;
    private String productName;
    private Long amount;
    @Enumerated(value = EnumType.STRING)
    private PaymentMethod method;
    @Temporal(TemporalType.TIMESTAMP)
    private Date expiry;
    @Column(columnDefinition = "boolean default false")
    private boolean overtime;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;
    @Temporal(TemporalType.TIMESTAMP)
    private Date deletedAt;


    private Date startDate;
    private Date endDate;
    private double amountUsd;
    private double rate;

    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }
}
