package com.lqwd.security.oauth2.service;

import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.security.oauth2.model.security.ConfirmationToken;
import com.lqwd.security.oauth2.repository.ConfirmationTokenRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ConfirmationTokenService {

    @Qualifier("confirmationTokenRepository")
    private final ConfirmationTokenRepository confirmationTokenRepository;
    private final EmailSenderService emailSenderService;


    @Value("${app.mail_confirmation_link}")
    private String mailConfirmationLink;

    @Value("${app.send_mail_from}")
    private String sendEmailFrom;

    @Value("${app.application_notification_to}")
    private String adminEmail;



    public ConfirmationToken save(ConfirmationToken confirmationToken){
        return confirmationTokenRepository.save(confirmationToken);
    }


    public ConfirmationToken findByConfirmationToke(String confirmationToken) {
        return  confirmationTokenRepository.findByConfirmationToken(confirmationToken);
    }

    public ConfirmationToken findByUserId(UUID userid) {
        return confirmationTokenRepository.findByUserid(userid);
    }

    public void sendConfirmationEmail(String recipientEmail, ConfirmationToken token) throws IOException {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/password-reset-template.html");

        String template = org.apache.commons.io.IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());

        String link = mailConfirmationLink + token.getConfirmationToken();

        String modified = MessageFormat.format(template, link);

        System.out.println(template);
        System.out.println(modified);

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject("[LQwD] Reset my LQwD account password");

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail(sendEmailFrom);
        sender.setRecipientType(RecipientType.TO);


        emailBody.setSender(sender);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName("");
        receiver.setEmail(recipientEmail);
        receiver.setRecipientType(RecipientType.TO);


        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setAttachments(new ArrayList<>());

        emailSenderService.sendEmail(emailBody);

        emailSenderService.sendNotificationToAdmin(recipientEmail, adminEmail, sendEmailFrom);

    }

    public void sendRegistrationEmail(String recipientEmail, ConfirmationToken token) throws IOException {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/welcome-confirm-template.html");

        String template = org.apache.commons.io.IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());
        String mailConfirmationLinkUpdated = mailConfirmationLink.replace("confirm-password", "confirm-account");
        String link = mailConfirmationLinkUpdated + token.getConfirmationToken();

        String modified = MessageFormat.format(template, link);

        System.out.println(template);
        System.out.println(modified);

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject("[LQwD] Welcome ot LQwD! Confirm Your Registration");

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail(sendEmailFrom);
        sender.setRecipientType(RecipientType.TO);


        emailBody.setSender(sender);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName("");
        receiver.setEmail(recipientEmail);
        receiver.setRecipientType(RecipientType.TO);


        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setAttachments(new ArrayList<>());

        emailSenderService.sendEmail(emailBody);

    }
}
