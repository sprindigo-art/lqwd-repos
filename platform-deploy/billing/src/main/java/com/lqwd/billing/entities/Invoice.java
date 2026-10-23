package com.lqwd.billing.entities;

import com.lqwd.billing.enums.InvoiceStatus;
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
import javax.persistence.OneToMany;
import javax.persistence.PrePersist;
import javax.persistence.PreUpdate;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@Entity
@Setter
@Getter
public class Invoice {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    private long amount = 0;
    private Date startDate;
    private Date endDate;
    private double amountUsd;
    private double rateUsd;

    @Enumerated(value = EnumType.STRING)
    private InvoiceStatus status;
    @Column(nullable = false)
    private String userId;
    private String paymentMethodId;
    @Enumerated(value = EnumType.STRING)
    private PaymentMethod paymentMethod;
    private boolean discountApplied;
    @OneToMany
    private List<Subscription> subscriptions = new ArrayList<>();
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
