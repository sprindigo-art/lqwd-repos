package com.lqwd.security.oauth2.model.security;

import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

import javax.persistence.*;
import java.util.Date;


@Entity
@Table(name = "ACCOUNTINFO")
@Getter
@Setter
public class AccountInfo {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id")
    private Long id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User_ user;

    @Column(name = "status")
    private String status;

    @Column(name = "plan")
    private String plan;

    @Temporal(TemporalType.TIMESTAMP)
    private Date createdDate;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "account_type")
    @Fetch(FetchMode.JOIN)
    private AccountType accountType;


    public AccountInfo(String plan, String status) {
        this.plan = plan;
        this.status = status;
    }

    public AccountInfo() { }
}
