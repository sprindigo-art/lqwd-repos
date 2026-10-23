package com.lqwd.billing.exceptions;

public class NotFoundException extends RuntimeException{
    int status;

    public NotFoundException(int status, String error) {
        super(error);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}