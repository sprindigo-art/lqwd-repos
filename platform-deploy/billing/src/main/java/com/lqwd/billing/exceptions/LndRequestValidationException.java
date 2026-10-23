package com.lqwd.billing.exceptions;

public class LndRequestValidationException extends RuntimeException{

    public LndRequestValidationException(String error) {
        super(error);
    }

}