package com.lqwd.consumer;


import com.lqwd.model.BatchNodeInfo;
import com.lqwd.schema.LndTransactionMessage;
import com.lqwd.service.LndNodeBalanceService;
import com.lqwd.service.LndNodeInfoService;
import lombok.RequiredArgsConstructor;
import org.apache.avro.specific.SpecificData;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class LNDNodeInfoConsumer {

    private static final Logger logger = LoggerFactory.getLogger(LNDMonitorConsumer.class);

    private final LndNodeInfoService lndNodeInfoService;
    private final LndNodeBalanceService lndNodeBalanceService;


    @KafkaListener(topics = {"lnd-node-info"}, containerFactory = "kafkaBatchListenerContainerFactory")
    public void handleNodeInfoEvent(List<ConsumerRecord> records) {

        logger.info("Receiving batch from :: lnd-node-info");

        List<BatchNodeInfo> batches = new ArrayList<>();

        for( ConsumerRecord r : records){

            LndTransactionMessage lndTransactionMessage = (LndTransactionMessage)
                    SpecificData.get().deepCopy(LndTransactionMessage.SCHEMA$, r.value());

            String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();

            try {

                JSONObject transaction = new JSONObject(transactionMessageAsString);
                BatchNodeInfo info = new BatchNodeInfo();
                info.setInfo(transaction);
                info.setNode(lndTransactionMessage.getReplyNodeId().toString());
                info.setUserId(lndTransactionMessage.getUsername().toString());
                info.setTimeStamp((Long)lndTransactionMessage.getTimestamp());

                batches.add(info);

            }catch (JSONException e) {

                logger.error(e.getMessage());

            }



        }

        lndNodeInfoService.createInfoFromBatchMonitoring(batches);

        logger.info("Finish processing node details batch from :: lnd-node-info");

    }

    @KafkaListener(topics = {"lnd-node-balance"}, containerFactory = "kafkaListenerContainerFactory")
    public void handleNodeBalanceEvent(ConsumerRecord consumerRecord) {

//        logger.info("Receiving message from Kafka :: Topic lnd-node-balance");

        LndTransactionMessage lndTransactionMessage = (LndTransactionMessage)
                SpecificData.get().deepCopy(LndTransactionMessage.SCHEMA$, consumerRecord.value());

        String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();

        try {
            JSONObject transaction = new JSONObject(transactionMessageAsString);

            lndNodeBalanceService.createBalanceFromMonitoring(transaction,
                    lndTransactionMessage.getReplyNodeId().toString(),
                    lndTransactionMessage.getUsername().toString());

        } catch (JSONException e) {

            logger.error(e.getMessage());

        }
    }

}
