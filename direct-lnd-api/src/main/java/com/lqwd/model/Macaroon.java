package com.lqwd.model;

import javax.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "LND_MAIN")
@Getter
@Setter
public class Macaroon {



    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(name = "file_name")
    private String filename;

    @Column(name = "node_name")
    private String nodename;

    @Column(name = "ip")
    private String ip;

    @Column(name = "externalip")
    private String externalip;


    @Column(name = "sfile",  columnDefinition="BLOB")
    private byte[] sfile;

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

    public String getIp() {
        return ip;
    }

    public void setIp(String ip) {
        this.ip = ip;
    }

    public String getExternalip() {
        return externalip;
    }

    public void setExternalip(String externalip) {
        this.externalip = externalip;
    }

    public byte[] getSfile() {
        return sfile;
    }

    public void setSfile(byte[] sfile) {
        this.sfile = sfile;
    }

    private static final char[] HEX_ARRAY = "0123456789ABCDEF".toCharArray();
    private static String bytesToHex(byte[] bytes) {
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
