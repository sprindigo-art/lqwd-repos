package com.lqwd.model.entities;

import com.lqwd.model.enums.ChannelStatus;
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
@Table(
        uniqueConstraints=
        @UniqueConstraint(columnNames={"channelPoint", "nodeName"})
)
public class UserLndChannel implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String userId;
    @Column(nullable = false)
    private String nodeName;
    private Boolean active;
    private String remotePubKey;
    @Column(nullable = false)
    private String channelPoint;
    private String channelId;
    private String capacity;
    private String localBalance;
    private String remoteBalance;
    private String commitFee;
    private String commitWeight;
    private String feePerKw;
    private String unsettledBalance;
    private String totalSatoshisSent;
    private String totalSatoshisReceived;
    private Boolean initiator;
    private Boolean isPrivate;
    private String numUpdates;
    private String chanStatusFlag;
    private Integer thawHeight;
    private String pushAmountSat;
    private String closeAddress;
    private String txId;
    private String openInitiator;
    private String closeInitiator;
    private Integer outputIndex;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;
    private ChannelStatus status;
    private Integer closeHeight;
    private String closingTxHash;
    private String chainHash;
    private String settledBalance;
    private String timeLockedBalance;
    private String closeType;
    private String type;



    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }
}
