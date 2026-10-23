package com.lqwd.security.oauth2.model.security;

import com.lqwd.security.oauth2.model.enums.DeploymentType;
import com.lqwd.security.oauth2.model.enums.LNDNodeRole;
import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;


@Entity
@Table(name = "LNDNODEINFO")
@Getter
@Setter
public class LndNodeInfo {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id")
    private Long id;

    @ManyToOne
    @JoinColumn(name="user_id", nullable=false)
    private User_ user;

    @Column(name = "status")
    @Enumerated(value = EnumType.STRING)
    private LNDNodeStatus status;

    @Column(name = "lndnodename")
    private String lndnodename;

    @Column(name = "externalip")
    private String externalip;

    @Column(name = "description")
    private String description;

    @Column(name = "port")
    private String port;

    @Column(name = "nodepubkey")
    private String nodepubkey;

    @Column(name = "namespace")
    private String namespace;

    @Column(name = "domain")
    private String domain;

    @Column(name = "watchtower")
    private String watchtower;

    @Temporal(TemporalType.TIMESTAMP)
    private Date createdDate;

    @Column(name = "is_routing_node")
    private Boolean isRoutingNode = false;

    @Column(name = "is_non_custodial")
    private Boolean isNonCustodial = false;

    @Column(name = "lit_node_name")
    private String litNodeName;

    @Column(name = "network")
    private String network;

    @Column(name = "node_alias")
    private String nodeAlias;

    @Column(length = 50)
    private String lndVersion;

    @Column(name = "confirmed")
    private Boolean confirmed = false;

    @Column(length = 50)
    private String scriptVersion;

    @Column(length = 50)
    private String privateAddress;

    @Column(length = 50)
    private String publicAddress;

    @Column(length = 50)
    private String instanceId;

    @Enumerated(value = EnumType.STRING)
    private DeploymentType deploymentType;

    private Boolean keySendEnabled = false;

    private String lndNodeRole;

    @Column(nullable = false, columnDefinition = "boolean default false")
    private Boolean paid = false;

}
