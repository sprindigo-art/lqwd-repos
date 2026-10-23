package com.lqwd.model.entity;

import lombok.*;

import javax.persistence.*;

@Entity
@Table(name = "lnd_main_v2")
@Getter
@Setter
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class LndFile {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    private String fileName;

    private String nodeName;

    private String network;

    private String fileType;

    private String domain;

    private byte[] sfile;

    private String pubkey;

    private boolean watchtower;

    private String rpchost;

    private String status;

    private String key;

    private Long cipherMethod;

    private boolean queuedForUpdate;

    private Long cipherMethodUpdate;

    private String rpcpass;

    private String rpcuser;

    private boolean isUserFile;

    private Long cipherKeyUpdate;
}
