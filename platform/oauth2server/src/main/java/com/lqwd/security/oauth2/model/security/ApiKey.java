package com.lqwd.security.oauth2.model.security;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.Date;
import java.util.UUID;

@Entity
@Table(name = "USER_APIKEY")
@Getter
@Setter
public class ApiKey {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @ManyToOne(cascade=CascadeType.ALL)
    @JoinColumn(name="user_id", nullable=false)
    private User_ user;

    @Column(name = "created")
    private Date created;

    @Column(name = "status")
    private String status;

    @Column(name = "apikey")
    private String apikey;

    @Column(name = "count")
    private Integer count;

    public ApiKey(){}

    public ApiKey(User_ user){
        this.user = user;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public User_ getUser() {
        return user;
    }

    public void setUser(User_ user) {
        this.user = user;
    }

    public Date getCreated() {
        return created;
    }

    public void setCreated(Date created) {
        this.created = created;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getApikey() {
        return apikey;
    }

    public void setApikey(String apikey) {
        this.apikey = apikey;
    }

    public Integer getCount() {
        return count;
    }

    public void setCount(Integer count) {
          this.count = count;
    }

    public void addOne() {
        if(this.count == null){
            this.count = 0;
        }
        this.count ++ ;
    }
}
