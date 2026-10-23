package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
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
public class UserActivity implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String activity;
    private String userId;
    private String username;
    private String ipAddress;
    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;

    public UserActivity(String activity,String userId, String username, String ipAddress){
        this.userId = userId;
        this.activity = activity;
        this.ipAddress = ipAddress;
        this.username = username;
    }

    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }


}