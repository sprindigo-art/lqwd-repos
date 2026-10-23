package com.lqwd.billing.entities;

import com.lqwd.billing.enums.DeploymentType;
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
import java.util.UUID;

@Entity
@Setter
@Getter
public class Product {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    private String productName;
    @Column(nullable = false, unique = true)
    private String productId;

    @Column(columnDefinition = "Text")
    private String description;

    @Enumerated(value = EnumType.STRING)
    private DeploymentType allowedDpType;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;

    @PrePersist
    private void beforeCreate() {
        dateCreated = new Date();
        productId = UUID.randomUUID().toString();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }

}
