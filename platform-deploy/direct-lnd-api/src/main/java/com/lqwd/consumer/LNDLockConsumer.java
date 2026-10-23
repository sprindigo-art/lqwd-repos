package com.lqwd.consumer;

import com.lqwd.model.entities.LndCreationStatusLog;
import com.lqwd.service.LNDLockHandler;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class LNDLockConsumer {

    private static final Logger logger = LoggerFactory.getLogger(LNDMonitorConsumer.class);

    private final LNDLockHandler lndLockHandler;



    @KafkaListener(topics = {"lnd-unlock-failed"},  containerFactory = "kafkaListenerContainerFactoryIntString")
    public void listenForLmdUnlockFailedEvent(String nodeId) {

        logger.info("Receiving message from Kafka :: Topic lnd-unlock-failed-monitor for " + nodeId);

        lndLockHandler.handleLNDEvent(nodeId, LndCreationStatusLog.CREATION_STATUS.IS_AWAITING_WALLET_UNLOCK.name());

    }

    @KafkaListener(topics = {"lnd-failed"},  containerFactory = "kafkaListenerContainerFactoryIntString")
    public void listenForLmdFailedEvent(String nodeId) {

        logger.info("Receiving message from Kafka :: Topic lnd-failed-monitor for " + nodeId);

        lndLockHandler.handleLNDEvent(nodeId, LndCreationStatusLog.CREATION_STATUS.NEED_RESTART.name());

    }
}
