package com.lqwd.consumer;


import com.lqwd.messaging.schemas.DestroyNode;
import com.lqwd.service.LNDDeploymentService;
import lombok.RequiredArgsConstructor;
import org.apache.avro.specific.SpecificData;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.json.JSONException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class LNDNodeConsumer {

    private static final Logger logger = LoggerFactory.getLogger(LNDMonitorConsumer.class);

    private final LNDDeploymentService lndDeploymentService;


    @KafkaListener(topics = {"destroy-node"}, containerFactory = "kafkaListenerContainerFactory")
    public void handleNodeInfoEvent(ConsumerRecord consumerRecord) {

        logger.info("Receiving message from Kafka :: Topic destroy-node");

        DestroyNode destroyNode = (DestroyNode)
                SpecificData.get().deepCopy(DestroyNode.SCHEMA$, consumerRecord.value());


        try {

            lndDeploymentService.destroyLND(destroyNode);

        } catch (JSONException e) {

            logger.error(e.getMessage());

        }
    }


}
