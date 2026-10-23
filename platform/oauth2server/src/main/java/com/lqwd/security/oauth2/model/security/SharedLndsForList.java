package com.lqwd.security.oauth2.model.security;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;

@Entity
@Table(name = "SHARED_LNDS")
@Getter
@Setter
public class SharedLndsForList {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id")
    private Long id;

    @ManyToOne
    @JoinColumn(name="user_id", nullable=false)
    private User_ user;


    @Column(name = "lndnodeinfo_id")
    private Long lndNodeInfoId;

    @ManyToOne
    @JoinColumn(name = "role_id", nullable=false)
    private Role_ role;

    @Column(name = "status")
    private String status;

    @Column(name = "created_date")
    private Date createdDate;


}
