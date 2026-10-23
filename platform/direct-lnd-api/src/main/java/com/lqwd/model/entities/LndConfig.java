package com.lqwd.model.entities;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.io.Serializable;
import java.util.Date;

@Entity
@Table(name = "LND_CONFIG")
@Getter
@Setter
public class LndConfig implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id", updatable = false, nullable = false)
    private Long id;

    @Column(name = "port9735", length = 50)
    private String port9735;

    @Column(name = "port10009", length = 50)
    private String port10009;

    @Column(name = "port8080", length = 50)
    private String port8080;

    @Column(name = "port29088", length = 50)
    private String port29088;

    @Column(name = "port29099", length = 50)
    private String port29099;

    @Column(name = "port835", length = 50)
    private String port835;

    @Column(name = "serviceexternalip", length = 50)
    private String serviceexternalip;

    @Column(name = "namespace", length = 50)
    private String namespace;

    @Column(name = "label", length = 50)
    private String label;

    @Column(name = "nodetype", length = 50)
    private String nodetype;

    @Column(name = "image", length = 150)
    private String image;

    @Column(name = "lndpassphrase", length = 50)
    private String lndpassphrase;

    @Column(name = "lndpassword", length = 50)
    private String lndpassword;

    @Column(name = "lndexternalip", length = 50)
    private String lndexternalip = getLndexternalip();

    @Column(name = "lndalias", length = 50)
    private String lndalias;

    @Column(name = "lndrpcuser", length = 50)
    private String lndrpcuser;

    @Column(name = "lndrpcpass", length = 50)
    private String lndrpcpass;

    @Column(name = "lndrpchost", length = 50)
    private String lndrpchost;

    @Column(name = "volumepath", length = 50)
    private String volumepath;

    @Column(name = "volumename", length = 50)
    private String volumename;

    @Column(name = "status", length = 50)
    private String status;

    @Column(columnDefinition = "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
    @Temporal(TemporalType.TIMESTAMP)
    private Date date;

    public LndConfig(String lndNodeName){
        this.label=lndNodeName;
    }

    static public String getExternalIp(){
        String externalIp = "54.71.76.33";
        return externalIp;
    }
}
