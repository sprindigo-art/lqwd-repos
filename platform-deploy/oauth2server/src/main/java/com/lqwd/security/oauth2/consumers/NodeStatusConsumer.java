package com.lqwd.security.oauth2.consumers;

import com.lqwd.messaging.schemas.NodeStatus;
import com.lqwd.messaging.schemas.SuccessSubscription;
import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import com.lqwd.security.oauth2.model.security.LndNodeInfo;
import com.lqwd.security.oauth2.service.LNDPortService;
import com.lqwd.security.oauth2.service.LndNodeInfoService;
import lombok.RequiredArgsConstructor;
import org.apache.avro.specific.SpecificData;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class NodeStatusConsumer {

    private static final Logger logger = LoggerFactory.getLogger(NodeStatusConsumer.class);

    private final LndNodeInfoService lndNodeInfoService;

    private final LNDPortService lndPortService;


    @KafkaListener(topics = {"node-status"},  containerFactory = "kafkaListenerContainerFactory")
    public void nodeStatusListener(ConsumerRecord consumerRecord) {

        logger.info("Received message from Kafka {}", consumerRecord.topic());

        NodeStatus nodeStatus = (NodeStatus)
                SpecificData.get().deepCopy(NodeStatus.SCHEMA$, consumerRecord.value());

        LndNodeInfo lndNodeInfo = lndNodeInfoService.findByLndNodeName(nodeStatus.getNode().toString());

        if (lndNodeInfo == null)
            return;

        if (nodeStatus.getInstanceId() != null)
            lndNodeInfo.setInstanceId(nodeStatus.getInstanceId().toString());
        if (nodeStatus.getStatus() != null)
            lndNodeInfo.setStatus(LNDNodeStatus.valueOf(nodeStatus.getStatus().toString()));
        if (nodeStatus.getPrivateAddress() != null)
            lndNodeInfo.setPrivateAddress(nodeStatus.getPrivateAddress().toString());
        if (nodeStatus.getPublicAddress() != null)
            lndNodeInfo.setPublicAddress(nodeStatus.getPublicAddress().toString());
        if (nodeStatus.getPubKey() != null)
            lndNodeInfo.setNodepubkey(nodeStatus.getPubKey().toString());

        lndNodeInfo.setNamespace("lqwd-lnd");

        lndNodeInfoService.save(lndNodeInfo);

        if (nodeStatus.getStatus().toString().equals(LNDNodeStatus.DELETED.toString())){
            lndPortService.releaseLndPort(Integer.parseInt(lndNodeInfo.getPort()));
        }


    }

    @KafkaListener(topics = {"subscription-success"},  containerFactory = "kafkaListenerContainerFactory")
    public void subscriptionSuccessListener(ConsumerRecord consumerRecord) {

        logger.info("Received message from Kafka :: version-update");

        SuccessSubscription successSubscription = (SuccessSubscription)
                SpecificData.get().deepCopy(SuccessSubscription.SCHEMA$, consumerRecord.value());

        LndNodeInfo lndNodeInfo = lndNodeInfoService.findByLndNodeName(successSubscription.getNodeId().toString());

        if (lndNodeInfo == null)
            return;

        lndNodeInfo.setPaid(true);

        lndNodeInfoService.save(lndNodeInfo);


    }
}
