package com.lqwd.security.oauth2.model.security;

import com.lqwd.security.oauth2.model.request.UserRequest;
import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "USER_DETAILS")
@Getter
@Setter
public class User_Details {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(name = "firstname")
    private String firstName;

    @Column(name = "lastname")
    private String lastName;

    @Column(name = "receive_news")
    private Boolean receiveNews;//change from primitive type to Object type. When null values in db, fix issue with setting NULL to primitive type when retrieved from DB

    @Column(name = "fa2")
    private Boolean fa2;

    @Column(name = "phone")
    private String phone;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User_ user;

    public User_Details(){}

    public User_Details(String firstName, String lastName){
        this.firstName = firstName;
        this.lastName = lastName;
    }

    public User_Details(UserRequest userRequest) {
        this.update(userRequest);

    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = firstName;
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = lastName;
    }

    public Boolean getReceiveNews() {
        return receiveNews;
    }

    public void setReceiveNews(Boolean receiveNews) {
        this.receiveNews = receiveNews;
    }

    public Boolean getFa2() {
        return fa2;
    }

    public void setFa2(Boolean fa2) {
        this.fa2 = fa2;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public User_ getUser() {
        return user;
    }

    public void setUser(User_ user) {
        this.user = user;
    }

    public void update(UserRequest userRequest) {
        if(userRequest.getFirstName() != null){
            this.firstName = userRequest.getFirstName();
        }
        if(userRequest.getLastName() != null){
            this.lastName = userRequest.getLastName();
        }
        if(userRequest.getFirstname() != null){
            this.firstName = userRequest.getFirstname();
        }
        if(userRequest.getLastname() != null){
            this.lastName = userRequest.getLastname();
        }
        if(userRequest.getReceivenews() != null){
            this.receiveNews = userRequest.getReceivenews();
        }
        if(userRequest.getReceiveNews() != null){
            this.receiveNews = userRequest.getReceiveNews();
        }
        if(userRequest.getFa2() != null){
            this.fa2 = userRequest.getFa2();
        }
        if(userRequest.getPhone() != null){
            this.phone = userRequest.getPhone();
        }
    }
}
