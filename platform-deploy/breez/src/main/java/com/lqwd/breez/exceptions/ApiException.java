package com.lqwd.breez.exceptions;

public class ApiException  extends RuntimeException{
    int status;
    public ApiException() {
        super();
    }

    public ApiException(int status, String error) {
        super(error);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}
