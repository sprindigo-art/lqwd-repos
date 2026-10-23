package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.*;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@Entity
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class LspTransaction implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String userId;
    private double amount;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date created;
    @Temporal(TemporalType.TIMESTAMP)
    private Date updated;
    private String transactionHash;
    private Integer noOfConfirmations;
    private String blockHash;
    private Integer blockHeight;
    private Double totalFees;
    private String rawTransactionHex;
    private String label;
    private String timeStamp;
    private String nodeName;
    @OneToMany(cascade = CascadeType.ALL, fetch = FetchType.EAGER)
    private List<LndTransactionOutputDetail> outputDetails = new ArrayList<>();

    @PrePersist
    private void setCreatedDate() {
        created = new Date();
    }

    @PreUpdate
    private void setUpdatedDate() {
        updated = new Date();
    }
}
