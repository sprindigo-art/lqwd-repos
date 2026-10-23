package com.lqwd.config;


import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lqwd.exceptions.*;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.validators.LndRequestValidator;
import liquibase.sdk.Main;
import net.minidev.json.JSONObject;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;


@ControllerAdvice(basePackages = {"com.lqwd.controller"})
@ResponseBody
public class ApiAdvice {


    @ExceptionHandler(BadRequestException.class)
    @ResponseStatus(value = HttpStatus.BAD_REQUEST)
    @ResponseBody
    public ApiResponse handleBadRequestException(BadRequestException e) {
        return new ApiResponse<>(HttpStatus.BAD_REQUEST.value(),null,e.getMessage());
    }


    @ExceptionHandler(LndException.class)
    @ResponseStatus(value = HttpStatus.INTERNAL_SERVER_ERROR)
    @ResponseBody
    public MainResponse handleLndException(LndException e) {
        ObjectMapper mapper = new ObjectMapper();
        String message = e.getMessage();
        try {
            Map<String, String> map = mapper.readValue(message, Map.class);
            if(map.containsKey("message")){
                message = map.get("message");
            }
            return new MainResponse(HttpStatus.INTERNAL_SERVER_ERROR.value(),LndException.class.getName(),null, message);
        } catch (JsonProcessingException ex) {
            return new MainResponse(HttpStatus.INTERNAL_SERVER_ERROR.value(),LndException.class.getName(),null,message);

        }

    }

    @ExceptionHandler(LndConnectionException.class)
    @ResponseStatus(value = HttpStatus.INTERNAL_SERVER_ERROR)
    @ResponseBody
    public MainResponse handleLndConnectionException(LndConnectionException e) {
        return new MainResponse(HttpStatus.INTERNAL_SERVER_ERROR.value(),LndConnectionException.class.getName(),null,e.getMessage());
    }
    @ExceptionHandler(LndRequestValidationException.class)
    @ResponseStatus(value = HttpStatus.BAD_REQUEST)
    @ResponseBody
    public MainResponse handleLndRequestValidationException(LndRequestValidationException e) {
        return new MainResponse(HttpStatus.BAD_REQUEST.value(),LndRequestValidationException.class.getName(),null,e.getMessage());
    }

    @ExceptionHandler(ServerErrorException.class)
    @ResponseStatus(value = HttpStatus.INTERNAL_SERVER_ERROR)
    @ResponseBody
    public ApiResponse handleServerErrorException(ServerErrorException e) {
        return new ApiResponse<>(HttpStatus.INTERNAL_SERVER_ERROR.value(),null,e.getMessage());
    }

    @ExceptionHandler(NotFoundException.class)
    @ResponseStatus(value = HttpStatus.NOT_FOUND)
    @ResponseBody
    public ApiResponse handleNotFoundException(NotFoundException e) {
        return new ApiResponse<>(HttpStatus.NOT_FOUND.value(),null,e.getMessage());
    }

    @ExceptionHandler(NullPointerException.class)
    @ResponseStatus(value = HttpStatus.BAD_REQUEST)
    @ResponseBody
    public ApiResponse handleRuntimeExceptionException(NullPointerException e) {
        e.printStackTrace();
        return new ApiResponse<>(HttpStatus.BAD_REQUEST.value(),null,e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(value = HttpStatus.BAD_REQUEST)
    @ResponseBody
    public ApiResponse handleRuntimeExceptionException(IllegalArgumentException e) {
        e.printStackTrace();
        return new ApiResponse<>(HttpStatus.BAD_REQUEST.value(),null,e.getMessage());
    }


    /**
     * Ensure validation messages are properly formatted in response
     * @param ex
     * @return
     */
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse handleValidationExceptions(MethodArgumentNotValidException ex) {
        String errrorMessage = ex.getBindingResult().getAllErrors().stream().map(error -> error.getDefaultMessage()).collect(Collectors.joining(" | "));
        return new ApiResponse<>(HttpStatus.BAD_REQUEST.value(),null,errrorMessage);
    }


    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(value = HttpStatus.BAD_REQUEST)
    @ResponseBody
    public ApiResponse handleMissingException(MissingServletRequestParameterException e) {
        return new ApiResponse<>(HttpStatus.BAD_REQUEST.value(),null,e.getMessage());
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(value = HttpStatus.INTERNAL_SERVER_ERROR)
    @ResponseBody
    public ApiResponse handleDefaultException(Exception e) {
        return new ApiResponse<>(HttpStatus.INTERNAL_SERVER_ERROR.value(),null,e.getMessage());
    }

}
