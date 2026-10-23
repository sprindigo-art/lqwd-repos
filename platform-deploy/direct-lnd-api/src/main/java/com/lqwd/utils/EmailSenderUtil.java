package com.lqwd.utils;

import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.service.KafkaMessageSender;

import java.util.ArrayList;
import java.util.List;

public class EmailSenderUtil {

    public static void createInfoEmailAddress(String[] emails, EmailBody emailBody,
                                       KafkaMessageSender kafkaMessageSender) {

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);


        List<EmailAddress> receivers = new ArrayList<>();
        for (String email : emails) {
            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName("Info");
            receiver.setEmail(email);
            receiver.setRecipientType(RecipientType.TO);
            receivers.add(receiver);
        }

        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);
        kafkaMessageSender.sendEmail(emailBody);
    }
}
