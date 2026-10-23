package com.lqwd.billing.entities;

import com.lqwd.billing.enums.SubFrequency;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.EnumType;
import javax.persistence.Enumerated;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.JoinColumn;
import javax.persistence.ManyToOne;
import javax.persistence.OneToOne;
import javax.persistence.PrePersist;
import javax.persistence.PreUpdate;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.util.Date;
import java.util.UUID;

@Entity
@Setter
@Getter
public class SubscriptionPlan {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    @Enumerated(value = EnumType.STRING)
    private SubFrequency frequency;
    private double price;
    @Column(nullable = false)
    private String productId;
    @Column(nullable = false)
    private String subscriptionPlanId;

    @OneToOne
    @JoinColumn(referencedColumnName = "subscriptionPlanId")
    private Discount discount;

    @ManyToOne
    @JoinColumn(referencedColumnName = "currencyId")
    private Currency currency;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;

    @PrePersist
    private void beforeCreate() {
        dateCreated = new Date();
        subscriptionPlanId = UUID.randomUUID().toString();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }

}
