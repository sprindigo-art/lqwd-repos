package com.lqwd.validators;

import org.springframework.beans.BeanWrapperImpl;

import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;

public  class NonNullFieldWhenOtherFieldHasCertainValueValidator implements ConstraintValidator<NonNullFieldWhenOtherFieldHasCertainValue, Object> {

    private String field;
    private String dependentField;
    private String dependentFieldValue;
    private String message;

    @Override
    public void initialize(NonNullFieldWhenOtherFieldHasCertainValue annotation) {
        field  = annotation.field();
        dependentField = annotation.dependentField();
        dependentFieldValue = annotation.dependentFieldValue();
        message  = annotation.message();
    }

    @Override
    public boolean isValid(Object value, ConstraintValidatorContext context) {
        if (value == null) {
            return false;
        }

        BeanWrapperImpl wrapper = new BeanWrapperImpl(value);
        Object fieldValue = wrapper.getPropertyValue(field);
        Object extractedDependFieldValue = wrapper.getPropertyValue(dependentField);

        boolean fieldIsInvalid = false;
        if(extractedDependFieldValue != null && extractedDependFieldValue.toString().equals(dependentFieldValue)){
            if(fieldValue == null){
                fieldIsInvalid = true;
            }
        }

        if (fieldIsInvalid) {
            context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
            return false;
        }
        return true;
    }
}
