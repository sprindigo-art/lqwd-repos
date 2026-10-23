package com.lqwd.model.entities;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;

@Entity
@Table(name = "LND_NODE_STATUS")
@Getter
@Setter
public class LndNodeStatus {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "pubkey")
    private String pubkey;

    @Column(name = "alias")
    private String alias;

    @Column(name = "lnd_node_name")
    private String lndNodeName;

    @Column(name = "status")
    private String status;

    @Column(name = "config_param")
    private String configParam;

    @Column(name = "result_updated")
    private String resultUpdated;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date created;
    @Temporal(TemporalType.TIMESTAMP)
    private Date updated;

    @PrePersist
    private void setCreated() {
        created = new Date();
    }

    @PreUpdate
    private void setUpdated() {
        updated = new Date();
    }
}
