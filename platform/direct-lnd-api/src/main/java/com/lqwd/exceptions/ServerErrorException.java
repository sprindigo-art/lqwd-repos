package com.lqwd.exceptions;

public class ServerErrorException extends RuntimeException{
    int status;

    public ServerErrorException(int status, String error) {
        super(error);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}