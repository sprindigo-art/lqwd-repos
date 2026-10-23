package com.lqwd.billing.models;

import lombok.Data;

@Data
public class MainResponse {
    private int status ;
    private String class_name;
    private String object;
    private String error;


    public MainResponse(){ }

    public MainResponse(String error){
        this.error = error;
    }

    public MainResponse(int status, String error){
        this.status = status;
        this.error = error;
    }

    public MainResponse(int status, String class_name, String object){
        this.status = status;
        this.class_name = class_name;
        this.object = object;

    }

    public MainResponse(int status, String class_name, String object, String error){
        this.status = status;
        this.class_name = class_name;
        this.object = object;
        this.error = error;
    }
}
