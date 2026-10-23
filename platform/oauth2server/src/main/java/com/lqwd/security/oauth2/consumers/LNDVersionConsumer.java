package com.lqwd.security.oauth2.consumers;

import com.lqwd.security.oauth2.service.LndNodeInfoService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class LNDVersionConsumer {

    private static final Logger logger = LoggerFactory.getLogger(LNDVersionConsumer.class);

    private final LndNodeInfoService lndNodeInfoService;


    @KafkaListener(topics = {"version-update"},  containerFactory = "kafkaListenerContainerFactoryString")
    public void listenForLmdUnlockFailedEvent(String message) {

        logger.info("Received message from Kafka :: version-update");

        lndNodeInfoService.updateVersionFromKafkaMessage(message);


    }
}
