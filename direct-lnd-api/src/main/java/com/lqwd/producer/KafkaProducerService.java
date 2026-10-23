package com.lqwd.producer;

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

    private KafkaTemplate<String, Tmessage> kafkaTemplate;

    @Autowired
    KafkaProducerService(KafkaTemplate<String, Tmessage> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public boolean sendMessage(TmessageKey tmessageKey, Tmessage tmessage, String topic) {

        logger.info("Sending message to Kafka :: Tmessage :: {}", tmessage.toString());


        Message<Tmessage> message = MessageBuilder
                .withPayload(tmessage)
                .setHeader(KafkaHeaders.TOPIC, topic)
                .setHeader(KafkaHeaders.MESSAGE_KEY, tmessageKey)
                .setHeader(KafkaHeaders.PARTITION_ID, 0)
                .build();

        ListenableFuture<SendResult<String, Tmessage>> future = kafkaTemplate.send(message);

        future.addCallback(new ListenableFutureCallback<SendResult<String, Tmessage>>() {

            @Override
            public void onSuccess(SendResult<String, Tmessage> result) {
                logger.info("Sent message=[" + tmessage.toString() + "] with offset=[" + result.getRecordMetadata().offset() + "]");
            }

            @Override
            public void onFailure(Throwable ex) {
                logger.info("Unable to send message=[" + tmessage.toString() + "] due to : " + ex.getMessage());
            }
        });

        return true;

    }

}
