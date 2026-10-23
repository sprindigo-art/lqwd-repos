package com.lqwd.security.oauth2.model.response;


import com.lqwd.security.oauth2.model.enums.DeploymentType;
import com.lqwd.security.oauth2.model.enums.LNDNodeRole;
import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import com.lqwd.security.oauth2.model.security.LndNodeInfo;
import lombok.Data;

import javax.persistence.Column;
import javax.persistence.EnumType;
import javax.persistence.Enumerated;

@Data
public class LndNodeResponse {

    private LNDNodeStatus status;

    private String nodeRole;

    private String lndNodeName;

    private String externalip;

    private String description;

    private String port;

    private String domain;

    private Integer id;

    private String nodepubkey;

    private String namespace;

    private String watchtower;


    private Boolean isRoutingNode = false;

    private Boolean isNonCustodial = false;

    private Boolean isConfirmed = false;

    private Boolean keySendEnabled = false;

    private Boolean paid = false;

    private String userId;

    private String litNodeName;

    private String network;

    private String ownerEmail;

    private String alias;

    private String lndVersion;

    private String scriptVersion;

    private String privateAddress;

    private String publicAddress;

    private String instanceId;

    private DeploymentType deploymentType;

    public LndNodeResponse(LNDNodeStatus status, String lndNodeName, String externalip, String description) {
        this.status = status;
        this.lndNodeName = lndNodeName;
        this.externalip = externalip;
        this.description = description;
    }

    public LndNodeResponse(LndNodeInfo lndNodeInfo) {
        this.status = lndNodeInfo.getStatus();
        this.lndNodeName = lndNodeInfo.getLndnodename();
        this.externalip = lndNodeInfo.getExternalip();
        this.description = lndNodeInfo.getDescription();
        this.keySendEnabled = lndNodeInfo.getKeySendEnabled();
        this.port = lndNodeInfo.getPort();
        this.id = lndNodeInfo.getId().intValue();
        this.nodepubkey = lndNodeInfo.getNodepubkey();
        this.namespace = lndNodeInfo.getNamespace();
        this.watchtower = lndNodeInfo.getWatchtower();
        this.domain = lndNodeInfo.getDomain();
        this.isRoutingNode = lndNodeInfo.getIsRoutingNode();
        this.isNonCustodial = lndNodeInfo.getIsNonCustodial();
        this.isConfirmed = lndNodeInfo.getConfirmed();
        this.network = lndNodeInfo.getNetwork();
        this.litNodeName = lndNodeInfo.getLitNodeName();
        this.ownerEmail = lndNodeInfo.getUser().getEmail();
        this.alias = lndNodeInfo.getNodeAlias();
        this.privateAddress = lndNodeInfo.getPrivateAddress();
        this.publicAddress = lndNodeInfo.getPublicAddress();
        this.instanceId = lndNodeInfo.getInstanceId();
        this.deploymentType = lndNodeInfo.getDeploymentType();
        this.scriptVersion = lndNodeInfo.getScriptVersion();
        this.lndVersion = lndNodeInfo.getLndVersion();
        this.userId = lndNodeInfo.getUser().getId().toString();
        this.paid = lndNodeInfo.getPaid();

        if(lndNodeInfo.getLndNodeRole() != null) {
            this.nodeRole = lndNodeInfo.getLndNodeRole();
        } else {
            this.nodeRole = LNDNodeRole.OWNER.toString();
        }
        //quick hack
        //since for existing nodes in db,  network info was not saved. So determine network from nodename
        if (network == null || network.isEmpty()) {
            if (lndNodeName.startsWith("tlnd")) {
                network = "testnet";
            } else if (lndNodeName.startsWith("slnd")) {
                network = "regtest";
            } else if (lndNodeName.startsWith("lnd")) {
                network = "mainnet";
            }
        }
    }

    public LNDNodeStatus getStatus() {
        return status;
    }

    public void setStatus(LNDNodeStatus status) {
        this.status = status;
    }

}
