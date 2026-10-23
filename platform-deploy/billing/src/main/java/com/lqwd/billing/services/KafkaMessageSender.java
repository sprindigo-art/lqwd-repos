package com.lqwd.billing.services;

import com.lqwd.messaging.schemas.DestroyNode;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.NodeStatus;
import com.lqwd.messaging.schemas.PushNotification;
import com.lqwd.messaging.schemas.SuccessSubscription;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.ArrayList;

@Service
@RequiredArgsConstructor
public class KafkaMessageSender {

    private final KafkaTemplate<String, Object> kafkaTemplate;
    private Logger logger = LoggerFactory.getLogger(KafkaMessageSender.class);

    @Async
    public void sendEmail(EmailBody emailBody) {

        if (emailBody.getAttachments() == null){
            emailBody.setAttachments(new ArrayList<>());
        }
        logger.info("kafka message sender line 28");
        kafkaTemplate.send("send-email",emailBody);
        logger.info("kafka message sender line 30");
    }

    @Async
    public void sendPush(PushNotification notification) {

        kafkaTemplate.send("send-push",notification);

    }

    @Async
    public void sendSuccessSubscription(SuccessSubscription successSubscription) {

        kafkaTemplate.send("subscription-success", successSubscription);

    }

    @Async
    public void sendNodeStatus(NodeStatus nodeStatus) {

        kafkaTemplate.send("node-status",nodeStatus);

    }

    @Async
    public void destroyNode(DestroyNode destroyNode) {

        kafkaTemplate.send("destroy-node",destroyNode);

    }



}
