package com.lqwd.security.oauth2.model.security;

import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;

@Entity
@Table(name = "SHARED_LNDS")
@Getter
@Setter
public class SharedLnds {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id")
    private Long id;

    @ManyToOne
    @JoinColumn(name="user_id", nullable=false)
    private User_ user;

    @ManyToOne
    @JoinColumn(name="lndnodeinfo_id", nullable=false)
    private LndNodeInfo lndNodeInfo;

    @ManyToOne
    @JoinColumn(name="role_id", nullable=false)
    private Role_ role;

    @Column(name = "status")
    private String status;

    @Column(name = "created_date")
    private Date createdDate;


}
