package com.lqwd.consumer;

import com.lqwd.model.entities.LndTransactionOutputDetail;
import com.lqwd.model.entities.LspMonitorInvoice;
import com.lqwd.model.entities.LspTransaction;
import com.lqwd.repository.LspMonitorInvoiceRepository;
import com.lqwd.repository.LspTransactionRepository;
import com.lqwd.schema.LndTransactionMessage;
import com.lqwd.service.LiquidityService;
import com.lqwd.service.StakingService;
import com.lqwd.service.UserLNDChannelService;
import lombok.RequiredArgsConstructor;
import org.apache.avro.specific.SpecificData;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class LNDMonitorConsumer {
    private static final Logger logger = LoggerFactory.getLogger(LNDMonitorConsumer.class);


    private final LspTransactionRepository lspTransactionRepository;

    private final LspMonitorInvoiceRepository lspInvoiceRepository;

    private final UserLNDChannelService userLNDChannelService;

    private final StakingService stakingService;

    private final LiquidityService liquidityService;


    /**
     * Monitors lnd-transaction-monitor topic to log all lnd transactions to db.
     *
     * @param consumerRecord
     */
    @KafkaListener(topics = {"lnd-transaction-monitor"}, containerFactory = "kafkaListenerContainerFactory")
    public void lndTransactionListener(ConsumerRecord consumerRecord) {

        logger.info("Receiving message for topic:" + consumerRecord.topic());

        LndTransactionMessage lndTransactionMessage = (LndTransactionMessage)
                SpecificData.get().deepCopy(LndTransactionMessage.SCHEMA$, consumerRecord.value());


        String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();
        LspTransaction lspTransaction = null;

        try {

            JSONObject transaction = new JSONObject(transactionMessageAsString).getJSONObject("result");

            lspTransaction = setTransactionParameters(lndTransactionMessage, transaction);

            Map<String, String> destMap = new HashMap<>();

            lspTransaction.getOutputDetails().stream()
                    .map(o -> destMap.put(o.getAddress(), ""));

            JSONArray destAddresses = transaction.getJSONArray("dest_addresses");

            for (int i = 0; i < destAddresses.length(); i++) {

                String address = destAddresses.getString(i);

                LndTransactionOutputDetail lndTransactionOutputDetail = LndTransactionOutputDetail.builder()
                        .address(address).build();

                if (destMap.get(address) == null) {
                    lspTransaction.getOutputDetails().add(lndTransactionOutputDetail);
                }

                stakingService.approveStakingRequestByBtcPayment
                        (lndTransactionMessage.getReplyNodeId().toString(), lspTransaction, address);

                liquidityService.approveLiquidityByBTCAddressRequest(lndTransactionMessage.getReplyNodeId().toString(),
                        address, lspTransaction);

            }


        } catch (JSONException e) {

            logger.error(e.getMessage());

        } catch (Exception e) {
            throw new RuntimeException(e);
        } finally {
            if (lspTransaction != null) {
                lspTransactionRepository.save(lspTransaction);
            }
        }

    }

    private LspTransaction setTransactionParameters(LndTransactionMessage lndTransactionMessage,
                                                    JSONObject transaction) {
        String txHash = transaction.getString("tx_hash");
        int noOfConfirmations = transaction.getInt("num_confirmations");
        String amount = transaction.getString("amount");
        String blockHash = transaction.getString("block_hash");
        int blockHeight = transaction.getInt("block_height");
        String timeStamp = transaction.getString("time_stamp");
        String totalFees = transaction.getString("total_fees");
        String rawTransactionHex = transaction.getString("raw_tx_hex");
        String label = transaction.getString("label");

        LspTransaction lspTransaction = lspTransactionRepository.findByTransactionHash(txHash)
                .orElse(new LspTransaction());

        lspTransaction.setUserId(lndTransactionMessage.getUsername().toString());
        lspTransaction.setAmount(Double.valueOf(amount));
        lspTransaction.setTransactionHash(txHash);
        lspTransaction.setNoOfConfirmations(noOfConfirmations);
        lspTransaction.setBlockHash(blockHash);
        lspTransaction.setBlockHeight(Integer.valueOf(blockHeight));
        lspTransaction.setTotalFees(Double.valueOf(totalFees));
        lspTransaction.setRawTransactionHex(rawTransactionHex);
        lspTransaction.setLabel(label);
        lspTransaction.setTimeStamp(timeStamp);
        lspTransaction.setNodeName(lndTransactionMessage.getReplyNodeId().toString());

        return lspTransaction;
    }



    /**
     * Monitors lnd-state-monitor topic to log all lnd transactions to db.
     *
     * @param consumerRecord
     */
    @KafkaListener(topics = {"lnd-channel-monitor"}, containerFactory = "kafkaListenerContainerFactory")
    public void listenForLndChannel(ConsumerRecord consumerRecord) {

        logger.info("Receiving message for topic:" + consumerRecord.topic());

        LndTransactionMessage lndTransactionMessage = (LndTransactionMessage) SpecificData.get()
                .deepCopy(LndTransactionMessage.SCHEMA$, consumerRecord.value());

        String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();


        try {

            JSONObject transaction = new JSONObject(transactionMessageAsString).getJSONObject("result");

            userLNDChannelService.logChannelEvents(transaction,
                    lndTransactionMessage);


        } catch (JSONException e) {
            logger.error(e.getMessage());
        }

        logger.info("Receiving message from Kafka :: Topic lnd-channel-monitor");

    }


    /**
     * Monitors lnd-invoice-monitor topic to log all lnd transactions to db.
     *
     * @param consumerRecord
     */
    @KafkaListener(topics = {"lnd-invoice-monitor"}, containerFactory = "kafkaListenerContainerFactory")
    public void listenForLndInvoice(ConsumerRecord consumerRecord) {

        logger.info("Receiving message for topic:" + consumerRecord.topic());

        LndTransactionMessage lndTransactionMessage = (LndTransactionMessage) SpecificData.get()
                .deepCopy(LndTransactionMessage.SCHEMA$, consumerRecord.value());

        String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();
        try {

            JSONObject transaction = new JSONObject(transactionMessageAsString).getJSONObject("result");

            logLSPInvoice(lndTransactionMessage, transactionMessageAsString, transaction);

            String state = transaction.getString("state");
            String paymentRequest = transaction.getString("payment_request");
            String rHash = transaction.getString("r_hash");
            String settleIndex = transaction.getString("settle_index");
            boolean isSettled = transaction.getBoolean("settled");


            liquidityService.approveLiquidityByInvoiceRequest(rHash, isSettled, settleIndex);

            //having a null pointer here to be fixed by Christian
            stakingService.approveStakingRequestByInvoice(paymentRequest, state);


        } catch (Exception e) {
            logger.error(e.getMessage());
        }


        logger.info("Receiving message from Kafka :: Topic: lnd-invoice-monitor");

    }

    /**
     * Monitors lnd-htlc-event-monitor topic to log lnd forwarding htlc events to db.
     *
     * @param consumerRecord
     */
    @KafkaListener(topics = {"lnd-htlc-event-monitor"}, containerFactory = "kafkaListenerContainerFactory")
    public void monitorHtlcEvents(ConsumerRecord consumerRecord) {

        logger.info("Received message from Kafka :: Topic {}", consumerRecord.topic());

        LndTransactionMessage lndTransactionMessage = (LndTransactionMessage) SpecificData.get()
                .deepCopy(LndTransactionMessage.SCHEMA$, consumerRecord.value());


        String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();

        try {

            JSONObject transaction = new JSONObject(transactionMessageAsString).getJSONObject("result");
//            logger.info("Received message from Kafka :: Topic {} line 233 ", consumerRecord.topic());
            userLNDChannelService.triggerNodeChannelSync(transaction,
                    lndTransactionMessage.getReplyNodeId().toString());
//            logger.info("Received message from Kafka :: Topic {} line 236", consumerRecord.topic());
            userLNDChannelService.logHTLCEvents(transaction, lndTransactionMessage.getUsername().toString(),
                    lndTransactionMessage.getReplyNodeId().toString());
//            logger.info("Received message from Kafka :: Topic {} line 239", consumerRecord.topic());
            userLNDChannelService.logForwardingHistory(transaction,
                    lndTransactionMessage.getUsername().toString(),
                    lndTransactionMessage.getReplyNodeId().toString());

//            logger.info("Received message from Kafka :: Topic {} line 244", consumerRecord.topic());
        } catch (JSONException e) {
            logger.error(e.getMessage());
            logger.info("Received message from Kafka :: Topic {} line 247 error line", consumerRecord.topic() );
        }


    }

    private void logLSPInvoice(LndTransactionMessage lndTransactionMessage, String transactionMessageAsString,
                               JSONObject transaction) {

        String rHash = transaction.getString("r_hash");

        LspMonitorInvoice lspInvoice = lspInvoiceRepository.findByRhash(rHash).orElse(new LspMonitorInvoice());

        lspInvoice.setAddIndex(transaction.getString("add_index"));
        lspInvoice.setAmtPaid(transaction.getString("amt_paid"));
        lspInvoice.setAmtPaidMsat(transaction.getString("amt_paid_msat"));
        lspInvoice.setAmtPaidSat(transaction.getString("amt_paid_sat"));
        lspInvoice.setCltvExpiry(transaction.getString("cltv_expiry"));
        lspInvoice.setCreationDate(transaction.getString("creation_date"));
        lspInvoice.setFallbackAddr(transaction.getString("fallback_addr"));
        lspInvoice.setExpiry(transaction.getString("expiry"));
        lspInvoice.setIsAmp(transaction.getBoolean("is_amp"));
        lspInvoice.setMemo(transaction.getString("memo"));
        lspInvoice.setIsKeysend(transaction.getBoolean("is_keysend"));
        lspInvoice.setPaymentRequest(transaction.getString("payment_request"));
        lspInvoice.setIsPrivate(transaction.getBoolean("private"));
        lspInvoice.setSettled(transaction.getBoolean("settled"));
        lspInvoice.setSettleDate(transaction.getString("settle_date"));
        lspInvoice.setSettleIndex(transaction.getString("settle_index"));
        lspInvoice.setValue(transaction.getString("value"));
        lspInvoice.setValueMsat(transaction.getString("value_msat"));
        lspInvoice.setFullJsonData(transactionMessageAsString);
        lspInvoice.setState(transaction.getString("state"));
        lspInvoice.setRhash(rHash);
        lspInvoice.setPreImage(transaction.getString("r_preimage"));
        lspInvoice.setPaymentAddr(transaction.getString("payment_addr"));
        lspInvoice.setUserId(lndTransactionMessage.getUsername().toString());
        lspInvoice.setNodeName(lndTransactionMessage.getReplyNodeId().toString());

        lspInvoiceRepository.save(lspInvoice);
    }


}


