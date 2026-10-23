package com.lqwd.service;

import com.lqwd.messaging.schemas.*;
import lombok.RequiredArgsConstructor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Arrays;

@Service
@RequiredArgsConstructor
public class KafkaMessageSender {

    private final KafkaTemplate<String, Object> kafkaTemplate;


    @Async
    public void sendEmail(EmailBody emailBody) {

        kafkaTemplate.send("send-email",emailBody);

    }

    @Async
    public void sendPush(PushNotification notification) {

        kafkaTemplate.send("send-push",notification);

    }

    @Async
    public void sendNodeStatus(NodeStatus nodeStatus) {

        kafkaTemplate.send("node-status",nodeStatus);

    }

    @Async
    public void sendSubscriptionStatus(SubscriptionAction action) {

        kafkaTemplate.send("subscription-action",action);

    }

}
