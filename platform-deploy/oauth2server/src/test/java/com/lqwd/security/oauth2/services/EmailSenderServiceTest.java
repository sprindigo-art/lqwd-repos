package com.lqwd.security.oauth2.services;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.messaging.schemas.EmailAddress;


import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.security.oauth2.service.DlaHttpClient;
import com.lqwd.security.oauth2.service.EmailSenderService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.util.ArrayList;
import java.util.Arrays;

@SpringBootTest
public class EmailSenderServiceTest {

    @Autowired
    private EmailSenderService emailSenderService;

    @Autowired
    private DlaHttpClient dlaHttpClient;


    @Test
    public  void testClient() throws Exception {
        String access = dlaHttpClient.getAccessToken();
        String b = dlaHttpClient.getAccessToken();

        System.out.println("access is: "+ access);
        System.out.println("access is: "+ b);
    }

    @Test
    public void sendEmailTest(){

        EmailBody emailBody = new EmailBody();
        emailBody.setBody("<h1>Test email</h1>");
        emailBody.setSubject("Test subject");

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);


        emailBody.setSender(sender);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName("Chris");
        receiver.setEmail("christian@lqwd.money");
        receiver.setRecipientType(RecipientType.TO);


        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setAttachments(new ArrayList<>());

        emailSenderService.sendEmail(emailBody);

    }
}
