package com.lqwd.model.entities;

import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.PrePersist;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
//import javax.validation.constraints.Email;
import java.io.Serializable;
import java.util.Date;

@Entity
@Getter
@Setter
@ToString
public class SignupConfirmationToken implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

//    @Email
    @Column(length = 50, unique = true)
    private String email;

    @Column(length = 50, updatable = false)
    private String inviteCode;

    @Column(length = 50)
    private Date usageDate;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;

    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }


}