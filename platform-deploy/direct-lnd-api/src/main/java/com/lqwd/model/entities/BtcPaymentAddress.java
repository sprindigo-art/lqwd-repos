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
public class BtcPaymentAddress implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private double amount;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date created;

    private String walletAddress;

    @PrePersist
    private void setCreatedDate() {
        created = new Date();
    }


}
