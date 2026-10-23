package com.lqwd.billing.entities;

import com.lqwd.billing.enums.SubscriptionStatus;
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
import javax.persistence.ManyToOne;
import javax.persistence.OneToOne;
import javax.persistence.PrePersist;
import javax.persistence.PreUpdate;
import javax.persistence.Table;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import javax.persistence.UniqueConstraint;
import java.util.Date;

@Entity
@Setter
@Getter
@SQLDelete(sql = "UPDATE subscription SET deleted_at = current_timestamp WHERE id=?")
@Where(clause = "deleted_at is NULL")
public class Subscription {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    @ManyToOne(optional = false)
    private Product product;
    @ManyToOne
    private Discount discount;
    @ManyToOne(optional = false)
    private SubscriptionPlan subscriptionPlan;
    @Column(nullable = false)
    private String userId;
    @Column(nullable = false, unique = true)
    private String nodeId;
    @Enumerated(value = EnumType.STRING)
    private SubscriptionStatus status = SubscriptionStatus.ACTIVE;
    @Temporal(TemporalType.TIMESTAMP)
    private Date expiry;
    private boolean invoiceCreated;
    private String firstName;
    private String lastName;
    private String email;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;
    @Temporal(TemporalType.TIMESTAMP)
    private Date deletedAt;

    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }

    @Override
    public boolean equals(Object object){
        return ((Subscription)object).getId().equals(this.id);
    }

}
