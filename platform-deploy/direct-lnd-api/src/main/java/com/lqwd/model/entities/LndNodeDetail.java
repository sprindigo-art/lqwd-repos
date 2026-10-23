package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.PrePersist;
import javax.persistence.PreUpdate;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.io.Serializable;
import java.util.Date;

@Entity
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class LndNodeDetail implements Serializable {
    @Id
    private String nodeName;
    private String userId;
    private String version;
    private String commit_hash;
    private String identity_pubkey;
    @Column(length = 10)
    private String color;
    private String alias;
    private int num_pending_channels;
    private int num_active_channels;
    private int num_inactive_channels;
    private int num_peers;
    private int block_height;
    private String block_hash;
    @Column(length = 100)
    private String best_header_timestamp;
    private boolean synced_to_chain;
    private boolean synced_to_graph;
    private String chains;
    @Column(columnDefinition = "TEXT")
    private String uris;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;

    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }


}