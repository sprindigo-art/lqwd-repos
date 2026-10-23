package com.lqwd.model;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;

@Entity
@Table(name = "LND_MAIN_V2")
@Getter
@Setter
public class MacaroonV2 {



    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(name = "file_name")
    private String filename;

    @Column(name = "node_name")
    private String nodename;

    @Column(name = "network")
    private String network;

    @Column(name = "file_type")
    private String filetype;

    @Column(name = "domain")
    private String domain;

    @Column(name = "sfile",  columnDefinition="BLOB")
    private byte[] sfile;


    @Column(name = "pubkey")
    private String pubkey;

    @Column(name = "watchtower")
    private String watchtower;

    @Column(name = "rpchost")
    private String rpchost;

    @Column(name = "status")
    private String status;

    private String key;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getFilename() {
        return filename;
    }

    public void setFilename(String filename) {
        this.filename = filename;
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

    public String getFiletype() {
        return filetype;
    }

    public void setFiletype(String filetype) {
        this.filetype = filetype;
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

    public String getRpchost() {
        return rpchost;
    }

    public void setRpchost(String rpchost) {
        this.rpchost = rpchost;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public byte[] getSfile() {
        return sfile;
    }

    public void setSfile(byte[] sfile) {
        this.sfile = sfile;
    }

    private static final char[] HEX_ARRAY = "0123456789ABCDEF".toCharArray();

    public static String bytesToHex(byte[] bytes) {
        char[] hexChars = new char[bytes.length * 2];
        for (int j = 0; j < bytes.length; j++) {
            int v = bytes[j] & 0xFF;
            hexChars[j * 2] = HEX_ARRAY[v >>> 4];
            hexChars[j * 2 + 1] = HEX_ARRAY[v & 0x0F];
        }
        return new String(hexChars);
    }

    public byte[] getOriginalSfile(){
        return this.sfile;
    }

    public String getKey() {
        if(sfile != null) {
            return bytesToHex(this.sfile);
        }
        return key;
    }

    public void setKey(String key) {
        this.key = key;
    }


}
