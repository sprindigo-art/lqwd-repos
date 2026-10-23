package com.lqwd.billing.consumers;

import com.lqwd.billing.services.SubscriptionRequestService;
import com.lqwd.billing.services.SubscriptionService;
import com.lqwd.messaging.schemas.SubscriptionAction;
import lombok.RequiredArgsConstructor;
import org.apache.avro.specific.SpecificData;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SubscriptionStatusConsumer {
    private static final Logger logger = LoggerFactory.getLogger(SubscriptionStatusConsumer.class);

    private final SubscriptionRequestService subscriptionRequestService;
    private final SubscriptionService subscriptionService;


    @KafkaListener(topics = {"subscription-action"}, containerFactory = "kafkaListenerContainerFactory")
    public void lndSubscriptionInvoiceListener(ConsumerRecord consumerRecord) {

        logger.info("Receiving message for topic:" + consumerRecord.topic());

        SubscriptionAction subscriptionAction = (SubscriptionAction)
                SpecificData.get().deepCopy(SubscriptionAction.SCHEMA$, consumerRecord.value());


        subscriptionRequestService.updateSubscriptionRequest(subscriptionAction);
        subscriptionService.handleDeletedNodeSubscription(subscriptionAction);

    }


}


