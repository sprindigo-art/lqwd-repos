package com.lqwd.billing.config;


import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.ResponseStatus;


@ControllerAdvice(basePackages = {"com.lqwd.billing.controllers"})
@ResponseBody
public class ApiAdvice {


    @ExceptionHandler(BadRequestException.class)
    @ResponseStatus(value = HttpStatus.BAD_REQUEST)
    @ResponseBody
    public ApiResponse handleBadRequestException(BadRequestException e) {
        return new ApiResponse<>(null, false, e.getMessage());
    }

}
