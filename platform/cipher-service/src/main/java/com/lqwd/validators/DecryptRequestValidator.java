package com.lqwd.validators;


import com.lqwd.model.entity.CipherMethod;
import com.lqwd.repository.CipherMethodRepository;
import com.lqwd.repository.LndFileRepository;
import org.apache.commons.codec.binary.Base64;
import com.lqwd.model.request.DecryptRequest;
import org.springframework.beans.factory.annotation.Autowired;

import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import java.util.Arrays;
import java.util.Optional;

public class DecryptRequestValidator implements ConstraintValidator<ValidDecryptRequest, DecryptRequest> {

    @Autowired
    private CipherMethodRepository cipherMethodRepository;

    @Autowired
    private LndFileRepository lndFileRepository;

    @Override
    public boolean isValid(DecryptRequest value, ConstraintValidatorContext context) {

        String requestType = DecryptRequest.CipherRequestType.EXTERNAL.name();
        if(value.getRequestType() != null){
            requestType = value.getRequestType();
        }

        if(value.getRequestType() != null){
            if( Arrays.stream(DecryptRequest.CipherRequestType.values()).filter((item) ->item.name().equals(value.getRequestType())).count() == 0){
                context.buildConstraintViolationWithTemplate("Invalid Request Type").
                        addConstraintViolation();
                return false;
            }
        }


        if(requestType.equals(DecryptRequest.CipherRequestType.EXTERNAL.name())){
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
        }

        if(requestType.equals(DecryptRequest.CipherRequestType.INTERNAL_FILE_ID.name())){
            if(value.getFileId() == null){
                context.buildConstraintViolationWithTemplate("fileId is required").
                        addConstraintViolation();
                return false;
            }else{
                if(!lndFileRepository.existsById(value.getFileId())){
                    context.buildConstraintViolationWithTemplate("Cannot find file with provided fileId").
                            addConstraintViolation();
                    return false;
                }
            }
        }

        if(requestType.equals(DecryptRequest.CipherRequestType.INTERNAL_FILE_NAME_AND_NODE.name())){
            if(value.getFileName() == null){
                context.buildConstraintViolationWithTemplate("fileName is required").
                        addConstraintViolation();
                return false;
            }

            if(value.getNodeName()== null){
                context.buildConstraintViolationWithTemplate("nodeName is required").
                        addConstraintViolation();
                return false;
            }

            if(lndFileRepository.existByFileNameAndNodeName("%"+value.getFileName(), value.getNodeName())  == 0){
                context.buildConstraintViolationWithTemplate("Cannot find file with provided fileName and nodeName").
                        addConstraintViolation();
                return false;
            }

        }
        return true;
    }



}
