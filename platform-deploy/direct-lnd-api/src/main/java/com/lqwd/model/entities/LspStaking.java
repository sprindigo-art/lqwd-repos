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
public class LspStaking implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private String userId;

    @Column(length = 100)
    private String userEmail;

    @Column(length = 100)
    private String userFirstname;

    private int days;

    private double amount;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date created;

    @Temporal(TemporalType.TIMESTAMP)
    private Date updated;

    private String status;

    @Enumerated(value = EnumType.STRING)
    private LspStaking.StakingType stakingType;

    private Long stakingReference;

    private String nodeName;

    @Temporal(TemporalType.TIMESTAMP)
    private Date paymentDate;



    @PrePersist
    private void setCreatedDate() {
        created = new Date();
    }


    @PreUpdate
    private void setUpdatedDate() {
        updated = new Date();
    }


    public enum StakingStatus {
        REQUESTED("OPEN"),
        ACTIVE("ACCEPTED"),
        DELETED("CANCELED"),
        PAID("SETTLED"),
        RENEWED("RENEWED"),
        WITHDREW("WITHDREW");

        public final String label;

        StakingStatus(String label) {
            this.label = label;
        }

        public static StakingStatus getStatus(String label){
            if(label.equals(REQUESTED.label)){
                return REQUESTED;
            }else  if(label.equals(ACTIVE.label)){
                return ACTIVE;
            }else  if(label.equals(DELETED.label)){
                return DELETED;
            }else  if(label.equals(PAID.label)){
                return PAID;
            }else{
                return null;
            }
        }
    }

    public enum StakingType {
        BTCADDRESS,
        INVOICE
    }
}
