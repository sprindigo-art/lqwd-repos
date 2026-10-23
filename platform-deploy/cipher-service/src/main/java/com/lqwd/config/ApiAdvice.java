package com.lqwd.config;


import com.lqwd.exception.ApplicationRequestException;
import com.lqwd.model.response.ErrorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.util.stream.Collectors;


@ControllerAdvice(basePackages = {"com.lqwd.controller"})
@ResponseBody
public class ApiAdvice {


    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(ApplicationRequestException.class)
    public ErrorResponse handleAllApplicationRequestsExceptions(ApplicationRequestException ex) {
        return ErrorResponse.builder().message(ex.getMessage()).build();
    }


    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ErrorResponse handleValidationMessages(MethodArgumentNotValidException ex) {
        String errrorMessage = ex.getBindingResult().getAllErrors().stream().map(error -> error.getDefaultMessage()).collect(Collectors.joining(" | "));
        return ErrorResponse.builder().message(errrorMessage).build();
    }

}
