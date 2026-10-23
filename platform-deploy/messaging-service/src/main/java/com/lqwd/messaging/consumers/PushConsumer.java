package com.lqwd.messaging.consumers;

import com.lqwd.messaging.schemas.PushNotification;
import com.lqwd.messaging.services.PushServerService;
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
public class PushConsumer {

    private final PushServerService pushServerService;
    private final CountDownLatch latch = new CountDownLatch(1);
    private Boolean didPushArrive;

    @KafkaListener(topics = "send-push", groupId = "group_id")
    public void consumeEmail(ConsumerRecord<String, PushNotification> record) {

        log.info("Received new push message from Kafka topic");

        setDidPushArrive(true);

        PushNotification push = SpecificData.get().deepCopy(PushNotification.SCHEMA$, record.value());
        pushServerService.sendPush(push);

    }


}
