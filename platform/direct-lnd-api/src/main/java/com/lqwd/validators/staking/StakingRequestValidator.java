package com.lqwd.validators.staking;
import com.lqwd.model.entities.LspStaking;
import com.lqwd.model.request.StakingRequest;
import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import java.util.Arrays;

public class StakingRequestValidator implements ConstraintValidator<ValidStakingRequest, StakingRequest> {


    @Override
    public boolean isValid(StakingRequest value, ConstraintValidatorContext context) {
        if(value.getAmount() == 0){
            context.buildConstraintViolationWithTemplate(" Invalid amount").
                    addConstraintViolation();
            return false;
        }
        if(value.getDays() == null){
            context.buildConstraintViolationWithTemplate("Days is required").
                    addConstraintViolation();
            return false;
        }
        if(value.getDays() == 0){
            context.buildConstraintViolationWithTemplate("Invalid days").
                    addConstraintViolation();
            return false;
        }


        if(value.getType() == null){
            context.buildConstraintViolationWithTemplate("Type is required").
                    addConstraintViolation();
            return false;
        }

        if( Arrays.stream(LspStaking.StakingType.values()).filter((item) ->item.equals(value.getType())).count() == 0){
            context.buildConstraintViolationWithTemplate("Invalid Type").
                    addConstraintViolation();
            return false;
        }

        if(LspStaking.StakingType.INVOICE.equals(value.getType())){

//            if(value.getIpAddress() == null){
//                context.buildConstraintViolationWithTemplate("IP Address is required for creating invoice").
//                        addConstraintViolation();
//                return false;
//            }

//            if(value.getPubKey() == null){
//                context.buildConstraintViolationWithTemplate("Public key is required for creating invoice").
//                        addConstraintViolation();
//                return false;
//            }
        }
        return true;
    }



}
