package com.lqwd.validators.staking;

import javax.validation.Constraint;
import javax.validation.Payload;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.*;

@Constraint(validatedBy = { StakingRequestValidator.class })
@Target({ TYPE, ANNOTATION_TYPE })
@Retention(RetentionPolicy.RUNTIME)
public @interface ValidStakingRequest {
    String message() default "Invalid staking request";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}