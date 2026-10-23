package com.lqwd.messaging.consumers;

import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.services.MailService;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.apache.avro.specific.SpecificData;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.concurrent.CountDownLatch;

@RequiredArgsConstructor
@Slf4j
@Component
@Setter
@Getter
public class EmailConsumer {

    private final MailService mailService;
    private final CountDownLatch latch = new CountDownLatch(1);
    private Boolean didMessageArrive;

    @KafkaListener(topics = "send-email", groupId = "group_id")
    public void consumeEmail(ConsumerRecord<String, EmailBody> record) {

        log.info("Received new email message from Kafka topic");

        setDidMessageArrive(true);
        EmailBody emailBody = SpecificData.get().deepCopy(EmailBody.SCHEMA$, record.value());
        mailService.sendMail(emailBody);

    }


}
