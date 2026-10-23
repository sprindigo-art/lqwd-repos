package com.lqwd.exceptions;

public class LndConnectionException extends RuntimeException{

    public LndConnectionException(String error) {
        super(error);
    }

}