package com.lqwd.security.oauth2.model.security;

import com.fasterxml.jackson.annotation.JsonIgnore;

import java.io.Serializable;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.HashSet;
import java.util.UUID;

import javax.persistence.*;

import com.lqwd.security.oauth2.model.request.UserRequest;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;
import org.hibernate.annotations.Where;
import org.hibernate.annotations.WhereJoinTable;

@Entity
@Table(name = "USER_", uniqueConstraints = { @UniqueConstraint(columnNames = { "USER_NAME", "EMAIL" }) })
@Getter
@Setter
@EqualsAndHashCode(of = "id")
public class User_ implements  Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "id")
    private UUID id;

    @Column(name = "user_name")
    private String username;

    @Column(name = "email")
    private String email;

    @Column(name = "password")
    private String password;

    @Column(name = "account_expired")
    private boolean accountExpired;

    @Column(name = "account_locked")
    private boolean accountLocked;

    @Column(name = "credentials_expired")
    private boolean credentialsExpired;

    @Column(name = "enabled")
    private boolean enabled;

    //@Temporal(TemporalType.TIMESTAMP)
    @Column(name = "created_date")
    private Date createdDate;


//    @Temporal(TemporalType.TIMESTAMP)
    @Column(name = "last_access_date")
    private Timestamp lastAccessDate;

    @Column(name = "created_at")
    private Timestamp createdAt;

    @Column(name = "updatedAt")
    private Timestamp updatedAt;

    @Column(name = "status")
    private String status;
    
    @Column(name = "allowed_no_of_lnd")
    private int allowedNoOfLnd;

    @Column(name = "f2asecret")
    private String f2asecret;

    @Column(name = "token_exp")
    private Integer tokenexp = 1000;

    @OneToOne(mappedBy = "user", cascade = CascadeType.ALL,
            fetch = FetchType.LAZY, optional = false)
    @Fetch(FetchMode.JOIN)
    private User_Details userDetails;


    @OneToOne(mappedBy = "user", cascade = CascadeType.ALL,
            fetch = FetchType.LAZY, optional = false)
    @Fetch(FetchMode.JOIN)
    private AccountInfo accountInfo;

    @OneToMany(mappedBy = "user",
            cascade = CascadeType.ALL,
            fetch = FetchType.LAZY,
            orphanRemoval = true)
    @Where(clause = " STATUS != 'DELETED' ")
    private Collection<LndNodeInfo> lndNodeInfos = new ArrayList<>();

    @OneToMany(mappedBy = "user",
            fetch = FetchType.LAZY,
            orphanRemoval = true,
            cascade = CascadeType.ALL)
    private Collection<ApiKey> apiKeys;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "USER_ROLE", joinColumns = @JoinColumn(name = "user_id", referencedColumnName = "id"), inverseJoinColumns = @JoinColumn(name = "role_id", referencedColumnName = "id"))
    @OrderBy
    @JsonIgnore
    private Collection<Role_> role_s;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "USERS_AUTHORITIES", joinColumns = @JoinColumn(name = "user_id", referencedColumnName = "id"), inverseJoinColumns = @JoinColumn(name = "authority_id", referencedColumnName = "id"))
    @OrderBy
    @JsonIgnore
    private Collection<Authority> authorities;

    private Double liquidityFee;

    public User_(){}

    public User_(String username, String password){
        this.username = username;
        this.password = password;
    }

    public User_(String username, String email, String password){
        this.email = email;
        this.username = username;
        this.password = password;
    }

    public AccountInfo getAccountInfo() {
        return accountInfo;
    }

    public void setAccountInfo(AccountInfo accountInfo) {
        this.accountInfo = accountInfo;
    }

    public Collection<LndNodeInfo> getLndNodeInfos() {
        return lndNodeInfos;
    }

    public void setLndNodeInfos(Collection<LndNodeInfo> lndNodeInfos) {
        this.lndNodeInfos = lndNodeInfos;
    }

    public void addLndNodeInfos(LndNodeInfo lndNodeInfo){
        if(this.lndNodeInfos == null){
            this.lndNodeInfos = new HashSet<>();
        }
        this.lndNodeInfos.add(lndNodeInfo);
    }

    public Integer getTokenexp() {
        return tokenexp;
    }

    public void setTokenexp(Integer tokenexp) {
        this.tokenexp = tokenexp;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }


    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public boolean isAccountExpired() {
        return accountExpired;
    }

    public void setAccountExpired(boolean accountExpired) {
        this.accountExpired = accountExpired;
    }

    public boolean isAccountLocked() {
        return accountLocked;
    }

    public void setAccountLocked(boolean accountLocked) {
        this.accountLocked = accountLocked;
    }

    public boolean isCredentialsExpired() {
        return credentialsExpired;
    }

    public void setCredentialsExpired(boolean credentialsExpired) {
        this.credentialsExpired = credentialsExpired;
    }


    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }


    public void setRole_s(Collection<Role_> role_s) {
        this.role_s = role_s;
    }


    public boolean isAccountNonExpired() {
        return !isAccountExpired();
    }


    public boolean isAccountNonLocked() {
        return !isAccountLocked();
    }


    public boolean isCredentialsNonExpired() {
        return !isCredentialsExpired();
    }

    public Date getCreatedDate() {
        return createdDate;
    }

    public void setCreatedDate(Date createdDate) {
        this.createdDate = createdDate;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getF2asecret() {
        return f2asecret;
    }

    public void setF2asecret(String f2asecret) {
        this.f2asecret = f2asecret;
    }

    public User_Details getUserDetails() {
        return userDetails;
    }

    public void setUserDetails(User_Details userDetails) {
        this.userDetails = userDetails;
    }

    public Collection<Role_> getRole_s() {
        return role_s;
    }

    public Collection<Authority> getAuthorities() {
        return authorities;
    }

    public void setAuthorities(Collection<Authority> authorities) {
        this.authorities = authorities;
    }

    public Collection<ApiKey> getApiKeys() {
        return apiKeys;
    }

    public void addApiKey(ApiKey apiKey){
        if(this.apiKeys == null){
            this.apiKeys = new HashSet<>();
        }
        this.apiKeys.add(apiKey);
    }

    public void setApiKeys(Collection<ApiKey> apiKey) {
        this.apiKeys = apiKey;
    }


    public void update(UserRequest userRequest) {
        if(!userRequest.getUsername().equals(this.username)){
            this.username = userRequest.getUsername();
        }
        if(!userRequest.getEmail().equals(this.email)){
            this.email = userRequest.getEmail();
            this.status = "NOTCONFIRM";
        }
        if(userRequest.getPassword() != null){
            this.password= userRequest.getPassword();
        }
        if(userRequest.getStatus() != null){
            this.status = userRequest.getStatus();
        }
        if(userRequest.getTokenexp() != null){
            this.tokenexp = userRequest.getTokenexp();
        }

    }
}
