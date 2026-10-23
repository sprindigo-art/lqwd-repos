package com.lqwd.billing.models;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {
    private T data;
    private boolean success;
    private String message;

    public ApiResponse(T data, boolean success, String message){
        this.data = data;
        this.success = success;
        this.message = message;
    }
}
