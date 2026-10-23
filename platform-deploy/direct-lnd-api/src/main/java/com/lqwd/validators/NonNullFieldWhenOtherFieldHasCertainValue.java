package com.lqwd.validators;

import com.lqwd.validators.staking.StakingRequestValidator;
//
//import javax.validation.Constraint;
//import javax.validation.Payload;
import java.lang.annotation.Repeatable;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.ANNOTATION_TYPE;
import static java.lang.annotation.ElementType.TYPE;

/**
 * custom validator that can be used to
 * do null checks for a field based on value of another field.
 */
//@Constraint(validatedBy = { NonNullFieldWhenOtherFieldHasCertainValueValidator.class })
@Target({ TYPE, ANNOTATION_TYPE })
@Retention(RetentionPolicy.RUNTIME)
@Repeatable(NonNullFieldWhenOtherFieldHasCertainValue.List.class)
public  @interface NonNullFieldWhenOtherFieldHasCertainValue {

    String field();
    String dependentField();
    String dependentFieldValue();
    String message() default "Field is Required";
    Class<?>[] groups() default {};
//    Class<? extends Payload>[] payload() default {};

    @Target({ TYPE, ANNOTATION_TYPE })
    @Retention(RetentionPolicy.RUNTIME)
    @interface List {
        NonNullFieldWhenOtherFieldHasCertainValue[] value();
    }

}
