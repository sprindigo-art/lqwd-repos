package com.lqwd.validators;


import com.lqwd.model.entity.CipherMethod;
import com.lqwd.model.request.EncryptRequest;
import com.lqwd.repository.CipherMethodRepository;
import org.apache.commons.codec.binary.Base64;
import org.springframework.beans.factory.annotation.Autowired;

import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import java.util.Arrays;
import java.util.Optional;

public class EncryptRequestValidator implements ConstraintValidator<ValidEncryptRequest, EncryptRequest> {

    @Autowired
    private CipherMethodRepository cipherMethodRepository;


    @Override
    public boolean isValid(EncryptRequest value, ConstraintValidatorContext context) {

        if(value.getInput() == null){
            context.buildConstraintViolationWithTemplate("Input is required").
                    addConstraintViolation();
            return false;
        }
        if(!Base64.isBase64(value.getInput())){
            context.buildConstraintViolationWithTemplate(" Invalid input. Base64 encoded input is required").
                    addConstraintViolation();
            return false;
        }

        if(value.getMethod() == null){
            context.buildConstraintViolationWithTemplate("Method is required").
                    addConstraintViolation();
            return false;
        }

        if(value.getMethod() != null){
            Optional<CipherMethod > result = cipherMethodRepository.findByName(value.getMethod());
            if(!result.isPresent()){
                context.buildConstraintViolationWithTemplate("Invalid method selected").
                        addConstraintViolation();
                return false;
            }
        }
        return true;
    }



}
