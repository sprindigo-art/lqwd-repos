package com.lqwd.model.response;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class ApiResponse<T> {

    private int status;
    private boolean success;
    private T data;
    private String message;

    public ApiResponse(int status, T data, String message){
        this.status = status;
        this.success = status == 200;
        this.data = data;
        this.message = message;
    }

    public ApiResponse(T data, String message){
        this.status = 200;
        this.success = status == 200;
        this.data = data;
        this.message = message;
    }
}
