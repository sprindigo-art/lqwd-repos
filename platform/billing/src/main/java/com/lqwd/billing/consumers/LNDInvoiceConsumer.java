package com.lqwd.billing.consumers;

import com.lqwd.billing.services.PaymentLogService;
import com.lqwd.billing.services.SubscriptionService;
import com.lqwd.schema.LndTransactionMessage;
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

@Service
@RequiredArgsConstructor
public class LNDInvoiceConsumer {
    private static final Logger logger = LoggerFactory.getLogger(LNDInvoiceConsumer.class);

    private final SubscriptionService subscriptionService;
    private final PaymentLogService paymentLogService;


    @KafkaListener(topics = {"subscription-invoice"}, containerFactory = "kafkaListenerContainerFactory")
    public void lndSubscriptionInvoiceListener(ConsumerRecord consumerRecord) {

        logger.info("Receiving message for topic:" + consumerRecord.topic());

        LndTransactionMessage lndTransactionMessage = (LndTransactionMessage)
                SpecificData.get().deepCopy(LndTransactionMessage.SCHEMA$, consumerRecord.value());


        String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();

        logger.info("Receiving message  transaction string : " + transactionMessageAsString);
        try {

            JSONObject transaction = new JSONObject(transactionMessageAsString).getJSONObject("result");

            String rHash = transaction.getString("r_hash");
            String settleIndex = transaction.getString("settle_index");
            boolean isSettled = transaction.getBoolean("settled");

            paymentLogService.logInvoicePayment(transaction);

            subscriptionService.handleSubscriptionPaymentByInvoice(rHash, isSettled, settleIndex);
            subscriptionService.handleSubscribeRequestByInvoice(rHash, isSettled, settleIndex);

        } catch (JSONException e) {

            logger.error(e.getMessage());

        }

    }

    @KafkaListener(topics = {"subscription-transaction"}, containerFactory = "kafkaListenerContainerFactory")
    public void lndTransactionListener(ConsumerRecord consumerRecord) {

        logger.info("Receiving message for topic:" + consumerRecord.topic());

        LndTransactionMessage lndTransactionMessage = (LndTransactionMessage)
                SpecificData.get().deepCopy(LndTransactionMessage.SCHEMA$, consumerRecord.value());


        String transactionMessageAsString = lndTransactionMessage.getReplyMessage().toString();
        logger.info("Receiving message for topic:" + consumerRecord.topic() + " transaction Message string: " + transactionMessageAsString);

        try {

            JSONObject transaction = new JSONObject(transactionMessageAsString).getJSONObject("result");

            JSONArray destAddresses = transaction.getJSONArray("dest_addresses");
            int noOfConfirmations = transaction.getInt("num_confirmations");
            String amount = transaction.getString("amount");

            for (int i = 0; i < destAddresses.length(); i++) {

                String address = destAddresses.getString(i);

                paymentLogService.logBtcPayment(transaction, address);
                
                subscriptionService.handleSubPaymentByBTCAddress(address, noOfConfirmations, amount);

                subscriptionService.handleSubscribeRequestByBTC(address, noOfConfirmations, amount);

            }


        } catch (JSONException e) {

            logger.error(e.getMessage());

        }

    }
}


