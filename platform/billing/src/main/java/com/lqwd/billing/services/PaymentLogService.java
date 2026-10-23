package com.lqwd.billing.services;

import com.lqwd.billing.consumers.LNDInvoiceConsumer;
import com.lqwd.billing.entities.BtcPaymentAddress;
import com.lqwd.billing.entities.LndInvoice;
import com.lqwd.billing.entities.PaymentLog;
import com.lqwd.billing.enums.PaymentMethod;
import com.lqwd.billing.repositories.BtcPaymentAddressRepository;
import com.lqwd.billing.repositories.LndInvoiceRepository;
import com.lqwd.billing.repositories.PaymentLogRepository;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PaymentLogService {

    private final PaymentLogRepository paymentLogRepository;
    private final LndInvoiceRepository lndInvoiceRepository;
    private final BtcPaymentAddressRepository btcPaymentAddressRepository;

    private static final Logger logger = LoggerFactory.getLogger(PaymentLogService.class);

    public void logInvoicePayment(JSONObject jsonData) {

        String rHash = jsonData.getString("r_hash");

        LndInvoice lndInvoice = lndInvoiceRepository.findByHashStr(rHash).orElse(new LndInvoice());
        PaymentLog paymentLog = paymentLogRepository.findByIdentifier(rHash).orElse(new PaymentLog());

        paymentLog.setIdentifier(rHash);
        paymentLog.setAmount(Long.parseLong(jsonData.getString("value")));
        paymentLog.setUserId(lndInvoice.getCreatedFor());
        paymentLog.setPaymentMethod(PaymentMethod.LND_INVOICE);
        paymentLog.setSettled(jsonData.getBoolean("settled"));
        paymentLog.setRawData(jsonData.toString());
        logger.info("Payment log for invoice : " + paymentLog.toString());
        paymentLogRepository.save(paymentLog);
    }

    public void logBtcPayment(JSONObject jsonData, String btcAddress) {

        int noOfConfirmations = jsonData.getInt("num_confirmations");
        String amount = jsonData.getString("amount");

        BtcPaymentAddress btcPaymentAddress = btcPaymentAddressRepository.findByWalletAddress(btcAddress)
                .orElse(new BtcPaymentAddress());

        PaymentLog paymentLog = paymentLogRepository.findByIdentifier(btcAddress)
                .orElse(new PaymentLog());

        paymentLog.setIdentifier(btcAddress);
        paymentLog.setConfirmations(noOfConfirmations);
        paymentLog.setAmount(Long.parseLong(amount));
        paymentLog.setUserId(btcPaymentAddress.getCreatedFor());
        paymentLog.setPaymentMethod(PaymentMethod.BTC_ADDRESS);
        paymentLog.setRawData(jsonData.toString());
        logger.info("Payment log for BTC payment : " + paymentLog.toString());
        paymentLogRepository.save(paymentLog);
    }
}
