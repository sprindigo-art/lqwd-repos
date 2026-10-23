package com.lqwd.messaging.services;

import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailAttachment;
import com.lqwd.messaging.schemas.EmailBody;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMailMessage;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import javax.activation.DataHandler;
import javax.mail.BodyPart;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
import javax.mail.util.ByteArrayDataSource;
import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Calendar;
import java.util.Date;

@Service
@RequiredArgsConstructor
public class MailService {

    public static final Logger logger = LoggerFactory.getLogger(MailService.class);

    private final JavaMailSender javaMailSender;
    private final TemplateEngine templateEngine;

    @Async
    public void sendMail(EmailBody emailBody) {

        logger.info("Sending email from: {}", emailBody.getSender().getEmail());
        boolean sendEmailIndicator = true;
        String fileName = "daily.txt";
        String forFile= "";
        for(EmailAddress address: emailBody.getRecipients()){
            forFile = address.getEmail();
        }

        boolean result = this.fileCheck();
            if(result){
                try (BufferedReader reader2 = new BufferedReader(new FileReader(fileName))) {
                    String line;
                    while ((line = reader2.readLine()) != null) {
                        if (line != null & line.contains(forFile)) {
                            System.out.println("Match found: " + line);
                            sendEmailIndicator = false;
                            // Perform additional actions if needed
                            break; // If you want to stop reading after the first match
                        }
                    }
                } catch (IOException e) {
                    logger.error("An error occurred when read line by line and compare with  {} creation {}",fileName, e.getMessage());
                }
            }

        try {
            if(sendEmailIndicator) {
                MimeMessage message = createMimeMessage(emailBody);
                javaMailSender.send(message);

                try (BufferedWriter writer = new BufferedWriter(new FileWriter(fileName, true))) {

                    writer.write(forFile);
                    writer.newLine();
                    System.out.println("Content appended to the file. " + forFile );
                } catch (IOException e) {
                    logger.error("An error occurred when content appended to  daily file {} ; {}",fileName, e.getMessage());
                }
                for(EmailAddress address: emailBody.getRecipients()){
                    logger.info("Email sent to: {}",address.getEmail());
                }
            }

        } catch (Exception e) {
            logger.error("An error occurred when sending email: {}", e.getMessage());
            return;
        }


    }


    private boolean fileCheck(){
        String fileName = "daily.txt";
        Path filePath = Paths.get(fileName);
        boolean resultFinal = true;
        if (!Files.exists(filePath)){
            this.createFile();
        } else {
            try (BufferedReader reader = new BufferedReader(new FileReader(filePath.toFile()))) {
                String firstLine = reader.readLine();
                System.out.println("File created Date " + firstLine);
                Date currentDate = new Date();

                long longFirstLine = 0 ;
                try {
                    longFirstLine = Long.parseLong(firstLine);
                    System.out.println("String can be converted to long: " + firstLine);
                } catch (NumberFormatException e) {
                    this.createFile();
                    System.out.println("String cannot be converted to long.");

                }
                long result = currentDate.getTime() - longFirstLine + 24*60*60*1000;

                if(result > 0){
                    resultFinal = true;
                } else {
                    this.createFile();
                }
            } catch (Exception e){
                logger.error("An error occurred when checking if  daily file {} read first line {}",fileName, e.getMessage());
            }
        }
        return resultFinal;
    }

    private void createFile(){
        String fileName = "daily.txt";
        Date currentDate = new Date();

        try (BufferedWriter writer = new BufferedWriter(new FileWriter(fileName))) {
            writer.write(String.valueOf(currentDate.getTime()));
            writer.newLine();
            System.out.println("created time saved in the file." + fileName);

        } catch (Exception e) {
            logger.error("An error occurred when created daily file {} creation {}",fileName, e.getMessage());
        }
    }
    private MimeMessage createMimeMessage(EmailBody emailBody) throws MessagingException {

        ArrayList<String> tos = new ArrayList<>();
        ArrayList<String> ccs = new ArrayList<>();
        ArrayList<String> bcc = new ArrayList<>();

        MimeMessage mimeMessage = javaMailSender.createMimeMessage();
        Multipart multipart = new MimeMultipart();

        for (EmailAttachment attachment : emailBody.getAttachments()) {
            byte[] attachmentByte = Base64.getMimeDecoder().decode(attachment.getContent());
            ByteArrayDataSource dSource = new ByteArrayDataSource(attachmentByte, attachment.getMime());
            try {
                MimeBodyPart mimeAttachmentPart = new MimeBodyPart();
                if(attachment.getInline())
                  mimeAttachmentPart.setContentID("<" + attachment.getCid() + ">");
                mimeAttachmentPart.setDisposition(attachment.getInline() ? Part.INLINE: Part.ATTACHMENT);
                mimeAttachmentPart.setDataHandler(new DataHandler(dSource));
                mimeAttachmentPart.setHeader("Content-Type", attachment.getMime());
                mimeAttachmentPart.setFileName(attachment.getName());
                multipart.addBodyPart(mimeAttachmentPart);
            } catch (MessagingException e) {
                logger.info(
                        "Issues were encountered while setting email attachment and cid: {}",
                        e.getMessage()
                );
            }


        }

        BodyPart mimeBodyPart = new MimeBodyPart();
        mimeBodyPart.setContent(processEmailBody(emailBody.getBody()),"text/html");
        multipart.addBodyPart(mimeBodyPart);

        mimeMessage.setContent(multipart);
        MimeMailMessage mailMessage = new MimeMailMessage(mimeMessage);

        for (EmailAddress address : emailBody.getRecipients()) {
            if (address.getRecipientType().equals(Message.RecipientType.CC)) {
                ccs.add(address.getEmail());
            } else if (address.getRecipientType().equals(Message.RecipientType.BCC)) {
                bcc.add(address.getEmail());
            } else {
                tos.add(address.getEmail());
            }
        }

        mailMessage.setCc(ccs.toArray(new String[]{}));
        mailMessage.setBcc(bcc.toArray(new String[]{}));
        mailMessage.setTo(tos.toArray(new String[]{}));
        mailMessage.setFrom(emailBody.getSender().getEmail());

        mailMessage.setSubject(emailBody.getSubject());

        return mailMessage.getMimeMessage();


    }

    private String processEmailBody(String emailBody){
        Context ctx = new Context(LocaleContextHolder.getLocale());

        ctx.setVariable("content", emailBody);
        ctx.setVariable("copyright", String.format("&copy; LQwD %s",
                Calendar.getInstance().get(Calendar.YEAR)));


        return this.templateEngine.process("mail/default.html", ctx);
    }

}