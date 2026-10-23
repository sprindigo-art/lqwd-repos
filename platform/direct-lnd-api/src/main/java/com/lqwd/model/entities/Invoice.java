package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.*;
import java.io.Serializable;
import java.math.BigDecimal;
import java.util.Date;

@Entity
@Builder
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Invoice implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(columnDefinition = "TEXT")
    private String hashStr;

    private Integer amt;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String paymentRequest;
    @Column(nullable = false,columnDefinition = "TEXT")
    private String paymentAddress;

    @Column(nullable = false)
    private String addIndex;

    @Column(nullable = false)
    private String nodeName;

    @Column
    private String settledIndex;
    private Boolean paid = false;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;

    private Date paymentDate;




    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }


}