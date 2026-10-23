package com.lqwd.security.oauth2.controller;

import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;

import com.lqwd.security.oauth2.service.EmailSenderService;
import liquibase.pro.packaged.T;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestContext;
import org.springframework.test.context.support.AbstractTestExecutionListener;

import java.util.ArrayList;
import java.util.Arrays;

public class TestExecutionListener extends AbstractTestExecutionListener {

    @Value("${app.test_failed_email_to}")
    private String testFailedEmailTo;
    EmailSenderService emailSenderService;
    ArrayList<String> errors = new ArrayList<>();

    @Override
    public void afterTestMethod(TestContext testContext) throws Exception{
        if(testContext.getTestException()!=null) {
            errors.add("Class Name: "+testContext.getTestClass()+
                    "<br> Method Name: "+testContext.getTestMethod() +
                    "<br> Error Description: "+testContext.getTestException());
        }
    }
    @Override
    public void afterTestClass(TestContext testContext) throws Exception{
        sendEmailForFailedTest(errors);

    }
    private void sendEmailForFailedTest(ArrayList<String> errors) {
        String message = "";
        for(String error: errors){
            message = message + String.format("Oauth2 test failed, please see the details below <br />%s <br>", error.toString());
        }
        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message.toString());
        emailBody.setSubject("LQWD Oauth2 test failed!");
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(testFailedEmailTo);
        receiver.setEmail(testFailedEmailTo);
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);
        // emailSenderService.sendEmail(emailBody);

    }
}

