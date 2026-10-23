package com.lqwd.model.entities;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;

@Entity
@Table(name = "lnd_creation_status_log")
@Getter
@Setter
@Builder
public class LndCreationStatusLog {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id", updatable = false, nullable = false)
    private Long id;

    private String nodeName;

    private String status;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date created;

    @PrePersist
    private void setCreatedDate() {
        created = new Date();
    }

    public static enum CREATION_STATUS {
        CREATING,
        RUNNING,
        DELETED,
        NEED_RESTART,
        RESTARTING,
        IS_AWAITING_WALLET_UNLOCK,
        IS_WAITING_USER_CONFIRMATION
    }
}
