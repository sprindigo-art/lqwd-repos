package lqwd.frontend.service;

import lombok.RequiredArgsConstructor;
import lqwd.frontend.model.Mail;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.thymeleaf.context.Context;
import org.thymeleaf.spring5.SpringTemplateEngine;

import javax.mail.MessagingException;
import javax.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;

@Service
public class MailService {


    public static final Logger logger = LoggerFactory.getLogger(MailService.class);

    private String sendEmailFrom = "info@lqwd.money";

    @Autowired
    private JavaMailSender javaMailSender;

    @Autowired
    private SpringTemplateEngine templateEngine;

    public void sendEmail(Mail mail) throws MessagingException {

        MimeMessage message = javaMailSender.createMimeMessage();
        MimeMessageHelper mimeMessageHelper = new MimeMessageHelper(
                message,
                MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED,
                StandardCharsets.UTF_8.name()
        );

//        mimeMessageHelper.addAttachment("LQwD.png", new ClassPathResource("static/images/logo/LQwD-notext.png"));

        Context context = new Context();
        context.setVariables(mail.getProps());

        String html = templateEngine.process("mail/beta-signup-email", context);

        mimeMessageHelper.setTo(mail.getMailTo());
        mimeMessageHelper.setText(html, true);
        mimeMessageHelper.setSubject(mail.getSubject());
        mimeMessageHelper.setFrom(mail.getFrom());

        javaMailSender.send(message);

    }

    @Async
    public void sendMail(String receiver, String message, String subject, String bcc_receiver) {

        try {
            SimpleMailMessage mailMessage = new SimpleMailMessage();
            mailMessage.setTo(receiver);
            mailMessage.setFrom(sendEmailFrom);
            if(bcc_receiver != null) {
                mailMessage.setBcc(bcc_receiver);
            }
            mailMessage.setSubject(subject);
            mailMessage.setText(message);

            javaMailSender.send(mailMessage);

        } catch (Exception e) {
            logger.error(e.getMessage());
        }

    }


}