package com.lqwd.model.entity;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;

@Entity
@Table(name = "secret_key_change_log")
@Getter
@Setter
@Builder
public class SecretKeyChangeLog {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id", updatable = false, nullable = false)
    private Long id;

    private String userId;

    private String previousKey;

    private String newKey;

    private String method;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date created;

    @PrePersist
    private void setCreatedDate() {
        created = new Date();
    }

}
