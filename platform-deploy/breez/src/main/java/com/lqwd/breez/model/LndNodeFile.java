package com.lqwd.breez.model;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;

@Entity
@Table(name = "LND_MAIN_V2")
@Getter
@Setter
public class LndNodeFile {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(name = "file_name")
    private String filename;

    @Column(name = "node_name")
    private String nodename;

    @Column(name = "network")
    private String network;

    @Column(name = "pubkey")
    private String pubkey;


    @Column(name = "sfile",  columnDefinition="BLOB")
    private byte[] sfile;

}
