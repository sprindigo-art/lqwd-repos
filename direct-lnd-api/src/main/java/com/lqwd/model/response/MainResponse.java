package com.lqwd.model.response;

import org.apache.kafka.common.protocol.types.Field;

public class MainResponse {
    private int status ;
    private String class_name;
    private String object;
    private String error;

    public int getStatus() {
        return status;
    }

    public void setStatus(int status) {
        this.status = status;
    }

    public String getClass_name() {
        return class_name;
    }

    public void setClass_name(String class_name) {
        this.class_name = class_name;
    }

    public String getObject() {
        return object;
    }

    public void setObject(String object) {
        this.object = object;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public MainResponse(){ }

    public MainResponse(String error){
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
