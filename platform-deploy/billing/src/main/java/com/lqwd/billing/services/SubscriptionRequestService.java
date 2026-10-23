package com.lqwd.billing.services;

import com.lqwd.billing.clients.HttpClientToken;
import com.lqwd.billing.entities.*;
import com.lqwd.billing.enums.PaymentMethod;
import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.MainResponse;
import com.lqwd.billing.models.SubscribeRequest;
import com.lqwd.billing.models.SubscribeRequestResponse;
import com.lqwd.billing.repositories.*;
import com.lqwd.billing.util.QRCodeGen;
import com.lqwd.billing.util.UserUtil;
import com.lqwd.messaging.schemas.DestroyNode;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailAttachment;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.messaging.schemas.SubscriptionAction;
import lombok.RequiredArgsConstructor;
import org.apache.commons.io.IOUtils;
import org.jetbrains.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.MessageFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.List;

@Service
@RequiredArgsConstructor
public class SubscriptionRequestService {

    private Logger logger = LoggerFactory.getLogger(SubscriptionRequestService.class);

    private final BtcPaymentAddressRepository btcPaymentAddressRepository;

    private final SubscriptionRequestRepository subscriptionRequestRepository;
    private final KafkaMessageSender kafkaMessageSender;   private final PlanRepository planRepository;
    private final InvoiceService invoiceService;
    private final BtcAddressService btcAddressService;
    private final LndInvoiceRepository lndInvoiceRepository;
    private final ProductRepository productRepository;

    private final InvoiceRepository invoiceRepository;

    private final HttpClientToken httpClientToken;
    private final BitcoinPriceRepository bitcoinPriceRepository;


    @Value("${app.frontend-url}")
    private String frontendUrl;

    @Value("${app.subscribe-request-validity-in-days}")
    private int subscribeRequestDaysValid;


    public void updateSubscriptionRequest(SubscriptionAction subscriptionAction) {

        SubscriptionRequest request = subscriptionRequestRepository
                .findByLndInvoiceId(subscriptionAction.getSubId().toString())
                .orElse(null);

        if (request == null)
            return;

        if (subscriptionAction.getAction().equals("DELETE")) {
            subscriptionRequestRepository.delete(request);
            return;
        }

        request.setNode(subscriptionAction.getNode().toString());
        subscriptionRequestRepository.save(request);


    }

    public void handleExpiredSubscriptionRequests() {

        List<SubscriptionRequest> requests = subscriptionRequestRepository.findAll();

        Date today = new Date();

        List<SubscriptionRequest> requestToDelete = new ArrayList<>();

        for (SubscriptionRequest r : requests) {

            if (today.after(r.getExpiry())) {
                //destroy node and alert customer
                DestroyNode destroyNode = new DestroyNode();
                destroyNode.setNodeId(r.getNode());
                destroyNode.setForce(false);

                kafkaMessageSender.destroyNode(destroyNode);

                try {
                    sendNodeDeletedEmail(r.getEmail(), r.getNode(), r.getProductName());
                } catch (IOException e) {
                    logger.info("Failed to send node deleted email : {}", e.getMessage());
                }

                requestToDelete.add(r);
            }
        }

        logger.info("Size is {}", requestToDelete.size());
        logger.info("Deleting requests ====");
        subscriptionRequestRepository.deleteAll(requestToDelete);


    }

    public SubscribeRequestResponse retrieveSubscribeRequestByNode(String nodeName,
                                                                   String accessToken) {

        SubscriptionRequest request = subscriptionRequestRepository.findByNode(nodeName).orElseThrow(
                () -> new BadRequestException(400, "requested subscription request not found")
        );

        MainResponse userinfo = httpClientToken.userInfo(
                accessToken);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        if (!userId.equals(request.getUserId())){
            throw new BadRequestException(403, "Oops! operation not permitted");
        }

        if (request.getMethod().equals(PaymentMethod.LND_INVOICE)){
            LndInvoice inv =  lndInvoiceRepository.findByUniqueID(request.getLndInvoiceId()).orElseThrow(
                    () -> new BadRequestException(400, "invoice not found for this node")
            );
            request.setLndInvoiceId(inv.getPaymentRequest());
        }


        SubscribeRequestResponse response = new SubscribeRequestResponse();

        response.setMethod(request.getMethod());
        response.setAmount(request.getAmount());
        response.setPaymentMedium(request.getLndInvoiceId());
        response.setAmountUsd(request.getAmountUsd());
        response.setRateUsd(request.getRate());
        response.setStartDate(request.getStartDate());
        response.setEndDate(request.getEndDate());


        return response;

    }

    public SubscribeRequestResponse subscribeRequest(SubscribeRequest request, String accessToken) throws Exception {

        BitcoinPrice bitcoinPrice = bitcoinPriceRepository.getLatestPrice();

        SubscriptionPlan plan = planRepository.findById(request.getPlanId()).orElseThrow(
                () -> new BadRequestException(400, "requested subscription plan not found")
        );

        Product product = productRepository.findById(request.getProductId()).orElseThrow(
                () -> new BadRequestException(400, "requested product not found")
        );

        MainResponse userinfo = httpClientToken.userInfo(
                accessToken);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        Calendar cal = Calendar.getInstance();
        cal.setTime(new Date());
        cal.add(Calendar.DAY_OF_YEAR, subscribeRequestDaysValid);

        String userId = UserUtil.retrieveUserId(userinfo.getObject());
        String email = UserUtil.retrieveUserEmail(userinfo.getObject());
        String firstName = UserUtil.retrieveUserFirstname(userinfo.getObject());
        String lastName = UserUtil.retrieveUserLastName(userinfo.getObject());

        SubscriptionRequest subscriptionRequest = new SubscriptionRequest();
        subscriptionRequest.setPlanId(request.getPlanId());
        subscriptionRequest.setDiscountId(request.getDiscountId());
        subscriptionRequest.setProductId(request.getProductId());
        subscriptionRequest.setUserId(userId);
        subscriptionRequest.setMethod(request.getMethod());
        subscriptionRequest.setEmail(email);
        subscriptionRequest.setFirstName(firstName);
        subscriptionRequest.setLastName(lastName);
        subscriptionRequest.setNode(request.getNodeName());
        subscriptionRequest.setProductName(product.getProductName());
        subscriptionRequest.setExpiry(cal.getTime());


        cal.setTime(new Date());
        int monthMaxDays = cal.getActualMaximum(Calendar.DAY_OF_MONTH);

        logger.info("Plan Price: " + String.valueOf(plan.getPrice()));
        logger.info("BTC Price in usd: " + String.valueOf(bitcoinPrice.getUsd()));
        logger.info("BTC price in use rounded: " + String.valueOf((bitcoinPrice.getUsd()/Math.pow(10, 8))));

//        logger.info("Plan Price to Sats for month: " + String.valueOf((plan.getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8)))));

        double amountPerDayInUsd =  ((double) plan.getPrice() / monthMaxDays);

        logger.info("Plan Price in USD for one day: " + amountPerDayInUsd + " month max days :" + monthMaxDays);


        int currentDay = cal.get(Calendar.DAY_OF_MONTH);
        int daysLeft = monthMaxDays - currentDay;

        Double amountInUsd = daysLeft * amountPerDayInUsd;

        logger.info("Plan Price in USD for left dates: " + amountInUsd +" for days:" + daysLeft);

        SimpleDateFormat format = new SimpleDateFormat("MM-yyyy");


        boolean invoiceExistForThisMonth = invoiceRepository.invoiceForDateForUser
                (userId, format.format(new Date())).isPresent();



        if (invoiceExistForThisMonth){
            amountInUsd += plan.getPrice();
            subscriptionRequest.setOvertime(true);
        }

        if (plan.getDiscount() != null) {
            amountInUsd = amountInUsd - plan.getDiscount().getAmount();
        }
        logger.info("Plan: " + amountInUsd +" for days:" + daysLeft + " bitcoin price " + bitcoinPrice.getUsd());
        long amountInSat = new Double(amountInUsd/(bitcoinPrice.getUsd()/Math.pow(10, 8))).longValue();

        logger.info("Plan Price in Satoshi for left dates: " + amountInSat +" for days:" + daysLeft);

        subscriptionRequest.setAmount( amountInSat);
        subscriptionRequest.setStartDate(new Date());

        cal.setTime(new Date());
        cal.add(Calendar.DATE, daysLeft);

        subscriptionRequest.setEndDate(cal.getTime());
        subscriptionRequest.setAmountUsd(amountInUsd);
        subscriptionRequest.setRate(bitcoinPrice.getUsd());

        logger.info("Subscription Request done");
        SubscribeRequestResponse res =  new SubscribeRequestResponse();
        res.setMethod(request.getMethod());
        logger.info("Subscription Request method is :" + request.getMethod().name() );
        if (request.getMethod().equals(PaymentMethod.LND_INVOICE)) {

            int expirySeconds = subscribeRequestDaysValid * 24 * 60 * 60;
            logger.info("Subscription Lnd_invoice request start");
            LndInvoice lndInvoice = invoiceService.createLndInvoice(amountInSat, expirySeconds);
            lndInvoice.setCreatedFor(userId);
            lndInvoiceRepository.save(lndInvoice);
            logger.info("Subscription Lnd_invoice save and lnd Invoice is :" + lndInvoice);
            subscriptionRequest.setLndInvoiceId(lndInvoice.getUniqueID());
            res.setTrackingId(lndInvoice.getUniqueID());
            res.setPaymentMedium(lndInvoice.getPaymentRequest());

        } else {
            logger.info("Subscription BTC address request start");
            String btcAddress = btcAddressService.createBtcAddress(amountInSat);
            BtcPaymentAddress btcPaymentAddress = BtcPaymentAddress.builder()
                    .walletAddress(btcAddress)
                    .createdFor(userId)
                    .amount(amountInSat)
                    .build();

            btcPaymentAddressRepository.save(btcPaymentAddress);
            logger.info("Subscription btc address created and saved and btc address is :" + btcAddress );
            subscriptionRequest.setLndInvoiceId(btcAddress);
            res.setTrackingId(btcAddress);
            res.setPaymentMedium(btcAddress);
        }

        subscriptionRequestRepository.save(subscriptionRequest);
        logger.info("Subscription Request Repository saved ");
        res.setAmountUsd(subscriptionRequest.getAmountUsd());
        res.setRateUsd(subscriptionRequest.getRate());
        res.setStartDate(subscriptionRequest.getStartDate());
        res.setEndDate(subscriptionRequest.getEndDate());
        res.setAmount(amountInSat);
        logger.info("Subscription before send email line 292");
        try {
            sendSubscribeRequestEmail(product.getProductName(), email,
                    firstName, amountInUsd, amountInSat, res.getPaymentMedium());
            logger.info("Subscription email sent to " + email);
        }catch (Exception e){
            logger.info("An error occurred when sending subscribe email : {}", e.getMessage());
        }
        logger.info("Subscription response is ready !" + res.toString());
        return res;

    }

//    @NotNull
//    private Long[] calculateAmountToPay(Calendar cal, Double amountPerDay) {
//
//        int monthMaxDays = cal.getActualMaximum(Calendar.DAY_OF_MONTH);
//        int currentDay = cal.get(Calendar.DAY_OF_MONTH);
//        int daysLeft = monthMaxDays - currentDay;
//
//        return new Long[]{daysLeft * amountPerDay, new Long(daysLeft)};
//    }

    private void sendSubscribeRequestEmail(String productName, String email,
                                           String firstName, Double amountInUsd, Long amount,
                                           String paymentMedium) throws Exception {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/sub-template.html");
        logger.info("Subscription email line 321");
        String template = IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());

        String modified = MessageFormat.format(template, String.format("%s-%s", "Node",
                        productName),
                amount, paymentMedium, amountInUsd, "cid:0123456789");
        logger.info("Subscription email line 327");
        String base64 = QRCodeGen.generateEAN13QrCodeImageB64(paymentMedium);

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject("Node Created");
        logger.info("Subscription email line 333");
        EmailAttachment attachment = new EmailAttachment();
        attachment.setCid("0123456789");
        attachment.setMime("image/png");
        attachment.setContent(base64);
        attachment.setName("qrcode");
        attachment.setInline(true);

        emailBody.setAttachments(Arrays.asList(attachment));

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);
        logger.info("Subscription email line 347");
        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(firstName);
        receiver.setEmail(email);
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);
        logger.info("Subscription email line 355");
        kafkaMessageSender.sendEmail(emailBody);
        logger.info("Subscription email line 357");
    }

    private void sendNodeDeletedEmail(String email, String node, String plan) throws IOException {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/sub-deleted-template.html");

        String template = IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());

        String modified = MessageFormat.format(template, email, node + " - " + plan,
                frontendUrl + "/nodes");

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject("Node Deleted");

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(email);
        receiver.setEmail(email);
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);

        kafkaMessageSender.sendEmail(emailBody);
    }

    public ApiResponse<String> delete (Long id){
        subscriptionRequestRepository.deleteById(id);
        return new ApiResponse<>("deleted", true, "deleted");
    }

}
