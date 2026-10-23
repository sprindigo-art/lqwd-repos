package com.lqwd.model.response;


import com.lqwd.model.MacaroonV2;

import javax.persistence.Column;

public class LndNodeWatchTowerResponse {

    private String nodename;

    private String network;

    private String domain;

    private String pubkey;

    private String watchtower;

    private String status;

    public LndNodeWatchTowerResponse(MacaroonV2 macaroonV2){
        this.nodename = macaroonV2.getNodename();
        this.network = macaroonV2.getNetwork();
        this.domain = macaroonV2.getDomain();
        this.pubkey = macaroonV2.getPubkey();
        this.watchtower = macaroonV2.getWatchtower();
        this.status = macaroonV2.getStatus();
    }


    public String getNodename() {
        return nodename;
    }

    public void setNodename(String nodename) {
        this.nodename = nodename;
    }

    public String getNetwork() {
        return network;
    }

    public void setNetwork(String network) {
        this.network = network;
    }

    public String getDomain() {
        return domain;
    }

    public void setDomain(String domain) {
        this.domain = domain;
    }

    public String getPubkey() {
        return pubkey;
    }

    public void setPubkey(String pubkey) {
        this.pubkey = pubkey;
    }

    public String getWatchtower() {
        return watchtower;
    }

    public void setWatchtower(String watchtower) {
        this.watchtower = watchtower;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
