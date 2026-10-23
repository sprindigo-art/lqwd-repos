package com.lqwd.security.oauth2.model.security;


import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;


import javax.persistence.*;
import java.io.Serializable;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "MSERVICE", uniqueConstraints = {@UniqueConstraint(columnNames = {"NAME"})})
@Getter
@Setter
@EqualsAndHashCode(of = "id")
public class Mservice implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id")
    private UUID id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "uriinfo", nullable = false)
    private String uriinfo;

    @Column(name = "description", nullable = true)
    private String description;

    @Column(name = "status", nullable = false)
    private String status;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "client_id")
    private OauthClientDetails client;

    @OneToMany(mappedBy = "mservice", fetch = FetchType.LAZY,
            cascade = CascadeType.ALL)
    private List<Role_> roles = new ArrayList<Role_>();


    public OauthClientDetails getClient() {
        return client;
    }

    public void setClient(OauthClientDetails client) {
        this.client = client;
    }

    public List<Role_> getRoles() {
        return roles;
    }

    public void setRoles(List<Role_> roles) {
        this.roles = roles;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getUriinfo() {
        return uriinfo;
    }

    public void setUriinfo(String uriinfo) {
        this.uriinfo = uriinfo;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

}
