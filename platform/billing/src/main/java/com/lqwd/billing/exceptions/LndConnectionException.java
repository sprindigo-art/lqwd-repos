package com.lqwd.billing.exceptions;

public class LndConnectionException extends RuntimeException{

    public LndConnectionException(String error) {
        super(error);
    }

}