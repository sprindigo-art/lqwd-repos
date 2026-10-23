package com.lqwd.validators;


import com.lqwd.model.entity.CipherMethod;
import com.lqwd.model.request.DecryptRequest;
import com.lqwd.model.request.LndFileItem;
import com.lqwd.model.request.SaveLndFileRequest;
import com.lqwd.repository.CipherMethodRepository;
import com.lqwd.repository.LndFileRepository;
import org.apache.commons.codec.binary.Base64;
import org.springframework.beans.factory.annotation.Autowired;

import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import java.util.Arrays;
import java.util.Optional;

public class SaveLndFileRequestValidator implements ConstraintValidator<ValidSaveLndFileRequest, SaveLndFileRequest> {

    @Autowired
    private CipherMethodRepository cipherMethodRepository;

    @Autowired
    private LndFileRepository lndFileRepository;

    @Override
    public boolean isValid(SaveLndFileRequest value, ConstraintValidatorContext context) {

        if(value.getDomain() == null){
            context.buildConstraintViolationWithTemplate("domain is required").
                    addConstraintViolation();
            return false;
        }

        if(value.getKey() == null){
            context.buildConstraintViolationWithTemplate("key is required").
                    addConstraintViolation();
            return false;
        }
        if(value.getNetwork() == null){
            context.buildConstraintViolationWithTemplate("network is required").
                    addConstraintViolation();
            return false;
        }

        if(value.getNodeName() == null){
            context.buildConstraintViolationWithTemplate("nodename is required").
                    addConstraintViolation();
            return false;
        }
        if(value.getPubkey() == null){
            context.buildConstraintViolationWithTemplate("pubkey is required").
                    addConstraintViolation();
            return false;
        }
        if(value.getRpchost() == null){
            context.buildConstraintViolationWithTemplate("rpchost is required").
                    addConstraintViolation();
            return false;
        }
        if(value.getStatus() == null){
            context.buildConstraintViolationWithTemplate("status is required").
                    addConstraintViolation();
            return false;
        }


        if(value.getRpcuser() == null){
            context.buildConstraintViolationWithTemplate("rpcuser is required").
                    addConstraintViolation();
            return false;
        }
        if(value.getRpcpass() == null){
            context.buildConstraintViolationWithTemplate("rpcpass is required").
                    addConstraintViolation();
            return false;
        }

        if(value.getFiles() == null || value.getFiles().size() == 0){
            context.buildConstraintViolationWithTemplate("please provide at least one file").
                    addConstraintViolation();
            return false;
        }

        
        for(LndFileItem file :  value.getFiles()){
            if(file.getFileType()== null){
                context.buildConstraintViolationWithTemplate("file type is required").
                        addConstraintViolation();
                return false;
            }


            if(file.getData() == null){
                context.buildConstraintViolationWithTemplate("Data is required").
                        addConstraintViolation();
                return false;
            }


            if(!Base64.isBase64(file.getData())){
                context.buildConstraintViolationWithTemplate(" Invalid data. Base64 encoded  is required").
                        addConstraintViolation();
                return false;
            }
            if(file.getIsUserFile() != null && file.getIsUserFile() == true && file.getEncryptBeforeSave() == true && (value.getPassword() == null || value.getPassword().trim().isEmpty())){
                context.buildConstraintViolationWithTemplate(" Invalid data. Please provide password since one of your files is set to be encrypted using user password").
                        addConstraintViolation();
                return false;
            }

        }


        return true;
    }
}
