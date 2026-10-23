package com.lqwd.security.oauth2.service;

import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;

@Service
@RequiredArgsConstructor
public class EmailSenderService {

    private final KafkaTemplate<String, Object> kafkaTemplate;


    @Async
    public void sendEmail(EmailBody emailBody) {

        kafkaTemplate.send("send-email",emailBody);

    }
    @Async
    public void sendNotificationToAdmin(String recipientEmail, String adminEmail, String sendEmailFrom) {

        EmailBody emailBody = new EmailBody();
        emailBody.setBody("Hi Admin, we have new registration one the platform. New email is: " + recipientEmail);
        emailBody.setSubject("New Registration on the platform");

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail(sendEmailFrom);
        sender.setRecipientType(RecipientType.TO);


        emailBody.setSender(sender);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName("");
        receiver.setEmail(adminEmail);
        receiver.setRecipientType(RecipientType.TO);


        emailBody.setRecipients(Arrays.asList(receiver));



        kafkaTemplate.send("send-email",emailBody);

    }
}
