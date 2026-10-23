package com.lqwd.exception;

public class ApplicationRequestException extends RuntimeException{
    int status;

    public ApplicationRequestException(int status, String error) {
        super(error);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}