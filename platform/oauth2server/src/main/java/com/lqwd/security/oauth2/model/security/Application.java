package com.lqwd.security.oauth2.model.security;

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
public class Application implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    @Column(nullable = false,columnDefinition="TEXT")
    private String productInfo;
    @Column(nullable = false,columnDefinition="TEXT")
    private String goal;
    @Column(nullable = false,columnDefinition="TEXT")
    private String currentSolution;
    @Column(nullable = false)
    private String companyName;
    @Column(nullable = false)
    private String contactName;
    @Column(nullable = false, unique = true)
    private String contactEmail;
    @Column(length = 20)
    private String contactPhone;
    private String companyAddress;
    @Column(length = 2)
    private String countryCode;
    @Column(length = 10)
    private String zipCode;
    private String companyUrl;
    private boolean hasKyc;

    @Column(updatable = false)
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateCreated;
    @Temporal(TemporalType.TIMESTAMP)
    private Date dateModified;

    private String inviteCode;

    @Temporal(TemporalType.TIMESTAMP)
    private Date usageDate;

    private String status;

    @PrePersist
    private void setDateCreated() {
        dateCreated = new Date();
    }

    @PreUpdate
    private void setDateModified() {
        dateModified = new Date();
    }


    public static enum ApplicationStatus {
        NEW,
        ACCEPTED ,
        REJECTED
    }
}
