package com.lqwd.billing.exceptions;

public class BadRequestException extends RuntimeException{
    int status;

    public BadRequestException(int status, String error) {
        super(error);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}