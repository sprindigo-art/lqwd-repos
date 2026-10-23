package com.lqwd.model.entities;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;

@Entity
@Table(name = "LND_NODE_CONFIGS")
@Getter
@Setter
public class LndNodeConfig {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(name = "version")
    private String version;

    @Column(name = "lnd_node_name")
    private String lndNodeName;

    @Column(name = "status")
    private String status;

    @Column(name = "config_param")
    private String configParam;

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
