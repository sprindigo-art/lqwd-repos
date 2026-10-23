package com.lqwd.producer;

import com.lqwd.schema.BackEndReply;
import com.lqwd.schema.FrontEndRequest;
import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.kafka.support.SendResult;
import org.springframework.messaging.Message;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Service;
import org.springframework.util.concurrent.ListenableFuture;
import org.springframework.util.concurrent.ListenableFutureCallback;

@Service
public class KafkaProducerService {

    private static final Logger logger = LoggerFactory.getLogger(KafkaProducerService.class);

    private KafkaTemplate<String, FrontEndRequest> kafkaTemplate;

    private KafkaTemplate<String, BackEndReply> kafkaTemplateB;

    private KafkaTemplate<String, FrontEndRequest> frontEndRequestKafkaTemplate;

    @Autowired
    KafkaProducerService(KafkaTemplate<String, FrontEndRequest> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

//    @Autowired
//    KafkaProducerService(KafkaTemplate<String, BackEndReply> kafkaTemplate){
//        this.kafkaTemplateB = kafkaTemplate;
//    }

    public boolean sendMessage(TmessageKey tmessageKey, FrontEndRequest frontEndRequest, String topic) {

        logger.info("Sending message to Kafka :: FrontEndRequest :: {}", frontEndRequest.toString());

        Message<FrontEndRequest> message = MessageBuilder
                .withPayload(frontEndRequest)
                .setHeader(KafkaHeaders.TOPIC, topic)
                .setHeader(KafkaHeaders.MESSAGE_KEY, tmessageKey)
                .setHeader(KafkaHeaders.PARTITION_ID, 0)
                .build();

        ListenableFuture<SendResult<String, FrontEndRequest>> future = kafkaTemplate.send(message);

        future.addCallback(new ListenableFutureCallback<SendResult<String, FrontEndRequest>>() {

            @Override
            public void onSuccess(SendResult<String, FrontEndRequest> result) {
                logger.info("Sent message=[" + frontEndRequest.toString() + "] with offset=[" + result.getRecordMetadata().offset() + "]");
            }

            @Override
            public void onFailure(Throwable ex) {
                logger.info("Unable to send message=[" + frontEndRequest.toString() + "] due to : " + ex.getMessage());
            }
        });

        return true;
    }

    public boolean sendMessageB(TmessageKey tmessageKey, BackEndReply backEndReply, String topic) {

        logger.info("Sending message to Kafka :: BackEndReply :: {}", backEndReply.toString());

        Message<BackEndReply> message = MessageBuilder
                .withPayload(backEndReply)
                .setHeader(KafkaHeaders.TOPIC, topic)
                .setHeader(KafkaHeaders.MESSAGE_KEY, tmessageKey)
                .setHeader(KafkaHeaders.PARTITION_ID, 0)
                .build();

        ListenableFuture<SendResult<String, BackEndReply>> future = kafkaTemplateB.send(message);

        future.addCallback(new ListenableFutureCallback<SendResult<String, BackEndReply>>() {

            @Override
            public void onSuccess(SendResult<String, BackEndReply> result) {
                logger.info("Sent message=[" + backEndReply.toString() + "] with offset=[" + result.getRecordMetadata().offset() + "]");
            }

            @Override
            public void onFailure(Throwable ex) {
                logger.info("Unable to send message=[" + backEndReply.toString() + "] due to : " + ex.getMessage());
            }
        });

        return true;
    }

}
