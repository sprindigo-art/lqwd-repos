package com.lqwd.security.oauth2.service;

import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.security.oauth2.controller.RegistrationController;
import com.lqwd.security.oauth2.model.security.Application;
import com.lqwd.security.oauth2.model.security.ConfirmationToken;
import com.lqwd.security.oauth2.model.security.User_;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;


@RefreshScope
@Service
@RequiredArgsConstructor
public class MailService {

    public static final Logger logger = LoggerFactory.getLogger(RegistrationController.class);

    private final ConfirmationTokenService confirmationTokenService;

    private final EmailSenderService  emailSenderService;

    private String sendEmailFrom = "info@lqwd.money";

    @Value("${app.application_notification_email}")
    private String applicationNotificationEmail;

    @Value("${app.mail_confirmation_link}")
    private String mailLink;


    @Async
    public void sendMail(User_ user, String status) {
        try {
            ConfirmationToken confirmationToken = confirmationTokenService.findByUserId(user.getId());

            if (confirmationToken == null)
                return;

            EmailBody emailBody = new EmailBody();
            emailBody.setAttachments(new ArrayList<>());

            if (status.equals("NOTCONFIRM")) {
                emailBody.setSubject("Complete Registration!");
                emailBody.setBody("To confirm your account, please click here : "
                        + mailLink + "/confirm-account?token=" + confirmationToken.getConfirmationToken());
            } else if (status.equals("PASSWORDREQUEST")) {
                emailBody.setSubject("Password recovery!");
                emailBody.setBody("To restore your password, please click here : "
                        + mailLink + "/reset-password?token=" + confirmationToken.getConfirmationToken());
            }

            EmailAddress sender = new EmailAddress();
            sender.setDisplayName("Info");
            sender.setEmail(sendEmailFrom);
            sender.setRecipientType(RecipientType.TO);

            List<EmailAddress> recipients = new ArrayList<>();


            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName(user.getUserDetails().getFirstName());
            receiver.setEmail(user.getEmail());
            receiver.setRecipientType(RecipientType.TO);
            recipients.add(receiver);

            if (mailLink.contains("stage") || mailLink.contains("192.168")) {

                EmailAddress cc = new EmailAddress();
                cc.setDisplayName("aziz@lqwd.money");
                cc.setEmail(user.getEmail());
                cc.setRecipientType(RecipientType.CC);

                EmailAddress bcc = new EmailAddress();
                bcc.setDisplayName("josh@lqwd.money");
                bcc.setEmail(user.getEmail());
                bcc.setRecipientType(RecipientType.BCC);

                recipients.add(cc);
                recipients.add(bcc);
            }

            emailBody.setRecipients(recipients);
            emailBody.setSender(sender);

            emailSenderService.sendEmail(emailBody);

            logger.info("Email sent successfully");

        }catch(Exception e){
            logger.error("An error occurred while sending mail: {}", e.getMessage());
        }

    }


    @Async
    public void sendRejectEmailForApplication(Application application, String signupLink, String email) {
        String message = String.format("<H2>Your Application Has Been Rejected</H2><br><br><p>Below are the details of your  application %s " +
                        "see details below</p><br>" +
                        "<ul>" +
                        "<li>Contact Name: %s</li>"+
                        "<li>Contact Email: %s</li>"+
                        "<li>Address: %s</li>"+
                        "<li>Zip code: %s</li>"+
                        "<li>Country code: %s</li>",
                application.getCompanyName(),
                application.getContactName(),application.getContactEmail(),
                application.getCompanyAddress(),application.getZipCode(),
                application.getCountryCode()
        );

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message);
        emailBody.setSubject("Application Rejected");
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail(sendEmailFrom);
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(email);
        receiver.setEmail(email);
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);

        emailSenderService.sendEmail(emailBody);
    }

    @Async
    public void sendAcceptEmailForApplication(Application application, String signupLink, String email) {
        String message = String.format("<H2>Your Application Has Been Accepted</H2><br><br><p>Below are the details of your  application %s " +
                        "see details below</p><br>" +
                        "<ul>" +
                        "<li>Contact Name: %s</li>"+
                        "<li>Contact Email: %s</li>"+
                        "<li>Address: %s</li>"+
                        "<li>Zip code: %s</li>"+
                        "<li>Country code: %s</li>"+
                        "</ul><br><br><H3>Use the registration link to signup %s</H3>",
                application.getCompanyName(),
                application.getContactName(),application.getContactEmail(),
                application.getCompanyAddress(),application.getZipCode(),
                application.getCountryCode(),signupLink
        );

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message);
        emailBody.setSubject("Application Accepted");
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail(sendEmailFrom);
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(email);
        receiver.setEmail(email);
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);

        emailSenderService.sendEmail(emailBody);
    }

   
    @Async
    public void sendAdminEmailForApplication(Application application, String signupLink) {
        String message = String.format("<H2>New Application</H2><br><br><p>There's a new application from %s " +
                        "see details below</p><br>" +
                        "<ul>" +
                        "<li>Contact Name: %s</li>"+
                        "<li>Contact Email: %s</li>"+
                        "<li>Address: %s</li>"+
                        "<li>Zip code: %s</li>"+
                        "<li>Country code: %s</li>"+
                        "</ul><br><br><H3>Use the registration link to signup %s</H3>",
                application.getCompanyName(),
                application.getContactName(),application.getContactEmail(),
                application.getCompanyAddress(),application.getZipCode(),
                application.getCountryCode(),signupLink
        );

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message);
        emailBody.setSubject("New Company Application");
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail(sendEmailFrom);
        sender.setRecipientType(RecipientType.TO);

        String[] addresses = applicationNotificationEmail.split(",");
        List<EmailAddress> receivers = new ArrayList<>();

        for(String address: addresses) {
            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName(address);
            receiver.setEmail(address);
            receiver.setRecipientType(RecipientType.TO);
            receivers.add(receiver);
        }

        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);

        emailSenderService.sendEmail(emailBody);
    }
}


