package com.lqwd.billing.services;

import com.lqwd.billing.clients.HttpClientToken;
import com.lqwd.billing.entities.*;
import com.lqwd.billing.enums.InvoiceStatus;
import com.lqwd.billing.enums.PaymentMethod;
import com.lqwd.billing.enums.SubscriptionStatus;
import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.MainResponse;
import com.lqwd.billing.models.PaymentRequest;
import com.lqwd.billing.models.ProductPlanResponse;
import com.lqwd.billing.models.ProductResponse;
import com.lqwd.billing.models.SubscribeRequest;
import com.lqwd.billing.models.SubscribeRequestResponse;
import com.lqwd.billing.repositories.*;
import com.lqwd.billing.util.UserUtil;
import com.lqwd.messaging.schemas.DestroyNode;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.NodeStatus;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.messaging.schemas.SubscriptionAction;
import com.lqwd.messaging.schemas.SuccessSubscription;
import lombok.RequiredArgsConstructor;
import org.apache.commons.io.IOUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SubscriptionService {


    @Value("${app.subscription-create-invoice-in-days}")
    private int subsCreateInvoiceIn;

    @Value("${app.subscription-number-of-conf}")
    private int subNumOfConfirmations;

    @Value("${app.frontend-url}")
    private String frontendUrl;

    private final HttpClientToken httpClientToken;

    private final SubscriptionRepository subscriptionRepository;

    private final PlanRepository planRepository;
    private final DiscountRepository discountRepository;
    private final ProductRepository productRepository;

    private final InvoiceRepository invoiceRepository;
    private final LndInvoiceRepository lndInvoiceRepository;

    private final SubscriptionRequestRepository subscriptionRequestRepository;

    private final InvoiceService invoiceService;
    private final BtcAddressService btcAddressService;

    private final BtcPaymentAddressRepository btcPaymentAddressRepository;

    private final KafkaMessageSender kafkaMessageSender;

    private final PaymentRepository paymentRepository;

    private final BitcoinPriceRepository bitcoinPriceRepository;

    Logger logger = LoggerFactory.getLogger(SubscriptionService.class);


    public String paySubscription(PaymentRequest request) throws Exception {

        Invoice invoice = invoiceRepository
                .findById(request.getInvoiceId()).orElseThrow(
                        () -> new BadRequestException(400, "Invoice not found")
                );

        invoice.setPaymentMethod(request.getMethod());
        String returnVal;

        if (request.getMethod().equals(PaymentMethod.LND_INVOICE)) {
            //create lnd invoice
            logger.info(invoice.toString());
            LndInvoice lndInvoice = invoiceService.createLndInvoice(invoice.getAmount(), 3600);
            lndInvoice.setCreatedFor(invoice.getUserId());
            lndInvoiceRepository.save(lndInvoice);
            invoice.setPaymentMethodId(lndInvoice.getUniqueID());

            returnVal = lndInvoice.getPaymentRequest();

        } else {
            //create btc address
            String btcAddress = btcAddressService.createBtcAddress(invoice.getAmount());
            BtcPaymentAddress btcPaymentAddress = BtcPaymentAddress.builder()
                    .walletAddress(btcAddress)
                    .createdFor(invoice.getUserId())
                    .amount(invoice.getAmount())
                    .build();

            btcPaymentAddressRepository.save(btcPaymentAddress);

            invoice.setPaymentMethodId(btcAddress);
            returnVal = btcAddress;
        }

        invoiceRepository.save(invoice);

        return returnVal;

    }


    public ApiResponse<String> cancelSubscriptionApi(Long subscriptionId, String accessToken){

        MainResponse userinfo = httpClientToken.userInfo(
                accessToken);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        return cancelSubscription(subscriptionId, userId);

    }

    public ApiResponse<String> cancelSubscription(Long subscriptionId, String userId){

       Subscription sub =  subscriptionRepository.findById(subscriptionId).orElseThrow(
                () -> new BadRequestException(401, "subscription not found")
        );

       if (!sub.getUserId().equals(userId)){
           throw new BadRequestException(403, "Operation forbidden");
       }


       sub.setStatus(SubscriptionStatus.CANCELLED);
       subscriptionRepository.save(sub);

       SimpleDateFormat format = new SimpleDateFormat("MM-yyyy");

       Invoice invoice = invoiceRepository.invoiceForDateForUser(userId, format.format(new Date()) )
                .orElse(null);

       if (invoice != null){
           BitcoinPrice bitcoinPrice = bitcoinPriceRepository.getLatestPrice();
           invoice.getSubscriptions().remove(sub);
           invoice.setAmount((long) (invoice.getAmount() - (sub.getSubscriptionPlan().getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8)))));
           invoiceRepository.save(invoice);
       }


        try {
            subscriptionCancelledEmail(sub.getEmail(), sub.getNodeId(), sub.getProduct().getProductName());
        } catch (IOException e) {
            logger.info("An error occurred when sending subscription cancelled email : {}", e.getMessage());
        }

        return new ApiResponse<>("Subscription cancelled successfully",
                true, "Subscription cancelled successfully");

    }

    private void sendNodeDeletedEmail(String email, String node, String plan) throws IOException {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/sub-deleted-template.html");

        String template = IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());

        String modified = MessageFormat.format(template, email, node + " - " + plan,
                frontendUrl+"/nodes");

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


    private void subscriptionCancelledEmail(String email, String node, String plan) throws IOException {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/sub-cancelled-template.html");

        String template = IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());

        String modified = MessageFormat.format(template,  plan + " - " + node);

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject("Subscription Cancelled");

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

    public Subscription subscribe(SubscriptionRequest request, PaymentMethod method) {

        Subscription subscription = createNewSubFromRequest(request, method);

        return subscriptionRepository.save(subscription);

    }

    private Subscription createNewSubFromRequest(SubscriptionRequest request, PaymentMethod method) {

        BitcoinPrice bitcoinPrice = bitcoinPriceRepository.getLatestPrice();
        logger.info(bitcoinPrice.toString());

        SubscriptionPlan plan = planRepository.findById(request.getPlanId()).orElseThrow(
                () -> new BadRequestException(400, "requested subscription plan not found")
        );

        Product product = productRepository.findById(request.getProductId()).orElseThrow(
                () -> new BadRequestException(400, "requested product not found")
        );

        Discount discount = request.getDiscountId() == null ? null :
                discountRepository.findById(request.getDiscountId()).orElse(null);


        Calendar cal = calendarLastDayOfMonth();

        if (request.isOvertime()){
            cal = calendarLastDayOfNextMonth();
        }

//        int field = plan.getFrequency().equals(SubFrequency.MONTHLY) ? Calendar.MONTH : Calendar.YEAR;
//        cal.add(field, 1);

        Payment payment = new Payment();
        payment.setNode(request.getNode());
        payment.setProduct(product.getProductName());
        payment.setStartDate(new Date());
        payment.setEndDate(cal.getTime());
        payment.setPaymentMethod(method);
        payment.setAmount((long) (plan.getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8))));
        payment.setCurrency(plan.getCurrency());
        payment.setUserId(request.getUserId());
        paymentRepository.save(payment);

        Subscription subscription = new Subscription();
        subscription.setExpiry(cal.getTime());
        subscription.setStatus(SubscriptionStatus.ACTIVE);
        subscription.setProduct(product);
        subscription.setDiscount(discount);
        subscription.setUserId(request.getUserId());
        subscription.setSubscriptionPlan(plan);
        subscription.setLastName(request.getLastName());
        subscription.setEmail(request.getEmail());
        subscription.setNodeId(request.getNode());
        subscription.setFirstName(request.getFirstName());

        return subscription;
    }

    public ResponseEntity<ApiResponse<List<Subscription>>> mySubscriptions(
            String accessToken) {

        MainResponse userinfo = httpClientToken.userInfo(
                accessToken);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        List<Subscription> subs = getSubscriptionByUserId(userId);

        return ResponseEntity.ok(new ApiResponse(subs, true,
                "subscriptions retrieved successfully"));


    }


    private List<Subscription> getSubscriptionByUserId(String userId) {
        return subscriptionRepository.findByUserId(userId);
    }

    private List<ProductResponse> getProducts() {

        return subscriptionRepository.findProducts();
    }


    public ResponseEntity<ApiResponse<List<ProductPlanResponse>>> getProductsApi() {

        List<ProductResponse> res = getProducts();

        Map<String, ProductPlanResponse> map = new HashMap<>();

        for (ProductResponse r : res) {
            if (map.get(r.getProduct().getProductId()) != null) {
                map.get(r.getProduct().getProductId()).getPlans().add(r.getSubscriptionPlan());
            } else {
                map.put(r.getProduct().getProductId(),
                        new ProductPlanResponse(r.getProduct(), r.getSubscriptionPlan()));
            }
        }

        logger.info(map.toString());
        
        return ResponseEntity.ok(new ApiResponse(new ArrayList<>(map.values()), true,
                "subscriptions retrieved successfully"));


    }

    public void handleSuspendedSubscriptions() {

        List<Subscription> suspendedSubscriptions = subscriptionRepository
                .findByStatus(SubscriptionStatus.SUSPENDED);

        Date today = createCalendarWithZeroTime().getTime();

        Calendar cal = Calendar.getInstance();

        List<Subscription> updatedSubs = new ArrayList<>();


        for (int i = 0; i < suspendedSubscriptions.size(); i++) {

            Subscription sub = suspendedSubscriptions.get(i);
            cal.setTime(sub.getExpiry());
            cal.add(Calendar.MONTH, 1);

            if (today.after(cal.getTime())) {
                sub.setStatus(SubscriptionStatus.EXPIRED);
                updatedSubs.add(sub);
                //destroy node

                DestroyNode destroyNode = new DestroyNode();
                destroyNode.setNodeId(sub.getNodeId());
                destroyNode.setForce(true);

                kafkaMessageSender.destroyNode(destroyNode);

                try {
                    sendNodeDeletedEmail(sub.getEmail(), sub.getNodeId(), sub.getProduct().getProductName());
                }catch (Exception e){
                    logger.info("An error occurred when sending node deleted email : {}", e.getMessage());
                }

            }


        }

        subscriptionRepository.saveAll(updatedSubs);
        subscriptionRepository.deleteAll(updatedSubs);

    }

    public void handleDeletedNodeSubscription(SubscriptionAction action) {

        if (!action.getAction().equals("DELETE"))
            return;

        Subscription subscription = subscriptionRepository
                .findByNodeId(action.getNode().toString()).orElse(null);

        if(subscription == null)
            return;

        subscriptionRepository.delete(subscription);

    }

    public void handleCancelledSubscriptions() {

        List<Subscription> cancelledSubscriptions = subscriptionRepository
                .findByStatus(SubscriptionStatus.CANCELLED);


        List<Subscription> updatedSubs = new ArrayList<>();


        for (int i = 0; i < cancelledSubscriptions.size(); i++) {

            Subscription sub = cancelledSubscriptions.get(i);

            DestroyNode destroyNode = new DestroyNode();
            destroyNode.setNodeId(sub.getNodeId());
            destroyNode.setForce(true);

            kafkaMessageSender.destroyNode(destroyNode);

            updatedSubs.add(sub);

        }

        subscriptionRepository.deleteAll(updatedSubs);

    }

    public void handleSubscriptionReminders() {

        List<Subscription> activeSubscriptions = subscriptionRepository
                .findByStatus(SubscriptionStatus.ACTIVE);


        Calendar cal = createCalendarWithZeroTime();
        Date today = cal.getTime();

        Map<String, List<Subscription>> groupedSubs7 = new HashMap<>();
        Map<String, List<Subscription>> groupedSubs3 = new HashMap<>();
        Map<String, List<Subscription>> groupedSubs1 = new HashMap<>();

        for (int i = 0; i < activeSubscriptions.size(); i++) {

            Subscription sub = activeSubscriptions.get(i);

            Calendar cal7 = createCalendarWithZeroTime();
            cal7.setTime(sub.getExpiry());
            cal7.add(Calendar.DAY_OF_YEAR, - 7);

            Calendar cal3 = createCalendarWithZeroTime();
            cal3.setTime(sub.getExpiry());
            cal3.add(Calendar.DAY_OF_YEAR, - 3);

            Calendar cal1 = createCalendarWithZeroTime();
            cal1.setTime(sub.getExpiry());
            cal1.add(Calendar.DAY_OF_YEAR, - 1);

            if(today.compareTo(cal7.getTime()) == 0){

                List<Subscription> subs = groupedSubs7.get(sub.getUserId()) == null ? new ArrayList<>() :
                        groupedSubs7.get(sub.getUserId());

                subs.add(sub);
                groupedSubs7.put(sub.getUserId(), subs);
            }

            if(today.compareTo(cal3.getTime()) == 0){

                List<Subscription> subs = groupedSubs3.get(sub.getUserId()) == null ? new ArrayList<>() :
                        groupedSubs3.get(sub.getUserId());

                subs.add(sub);
                groupedSubs3.put(sub.getUserId(), subs);
            }

            if(today.compareTo(cal1.getTime()) == 0){

                List<Subscription> subs = groupedSubs1.get(sub.getUserId()) == null ? new ArrayList<>() :
                        groupedSubs1.get(sub.getUserId());

                subs.add(sub);
                groupedSubs1.put(sub.getUserId(), subs);
            }

        }

        for (List<Subscription> sub : groupedSubs7.values()){
            try {
                sendSubscriptionReminderEmail(7, sub, sub.get(0).getEmail());
            } catch (IOException e) {
                logger.info("An error occurred when sending 7 days reminder : {}", e.getMessage());
            }
        }

        for (List<Subscription> sub : groupedSubs3.values()){
            try {
                sendSubscriptionReminderEmail(3, sub, sub.get(0).getEmail());
            } catch (IOException e) {
                logger.info("An error occurred when sending 3 days reminder : {}", e.getMessage());
            }
        }

        for (List<Subscription> sub : groupedSubs1.values()){
            try {
                sendSubscriptionReminderEmail(1, sub, sub.get(0).getEmail());
            } catch (IOException e) {
                logger.info("An error occurred when sending 1 days reminder : {}", e.getMessage());
            }
        }

    }


    public void handleSubscriptions() {

        List<Subscription> activeSubscriptions = subscriptionRepository
                .findByStatus(SubscriptionStatus.ACTIVE);

        Date today = createCalendarWithZeroTime().getTime();

        Calendar subscriptionCal = Calendar.getInstance();


        List<Subscription> updatedSubs = new ArrayList<>();
        Map<String, Invoice> groupedInvoice = new HashMap<>();

        BitcoinPrice bitcoinPrice = bitcoinPriceRepository.getLatestPrice();

        for (int i = 0; i < activeSubscriptions.size(); i++) {

            Subscription sub = activeSubscriptions.get(i);

            if (today.after(sub.getExpiry())) {
                sub.setStatus(SubscriptionStatus.SUSPENDED);
                updatedSubs.add(sub);
                //suspend node

                NodeStatus nodeStatus = new NodeStatus();
                nodeStatus.setStatus("SUSPENDED");
                nodeStatus.setNode(sub.getNodeId());

                kafkaMessageSender.sendNodeStatus(nodeStatus);

                continue;
            }

            subscriptionCal.setTime(sub.getExpiry());
            subscriptionCal.add(Calendar.DAY_OF_YEAR, -subsCreateInvoiceIn);


            // create invoice
            if (today.after(subscriptionCal.getTime()) && !sub.isInvoiceCreated()) {

                Invoice invoice = groupedInvoice.get(sub.getUserId());

                if (invoice == null) {
                    invoice = new Invoice();
                }

                Calendar cal = Calendar.getInstance();

                invoice.getSubscriptions().add(sub);
                invoice.setStatus(InvoiceStatus.PENDING);
                invoice.setUserId(sub.getUserId());
                //count next month 1 day
                cal.setTime(new Date());
                cal.add(Calendar.MONTH, 1);
                cal.set(Calendar.DATE, 1);

                invoice.setStartDate(cal.getTime());
                // count next month last day
                int monthMaxDays = cal.getActualMaximum(Calendar.DAY_OF_MONTH);
                cal.add(Calendar.DATE, monthMaxDays);

                invoice.setEndDate(cal.getTime());



//                long amountInSat = new Double(sub.getSubscriptionPlan().getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8))).longValue();
//                invoice.setAmount( amountInSat);
                invoice.setAmountUsd(sub.getSubscriptionPlan().getPrice());
                invoice.setRateUsd(bitcoinPrice.getUsd());

                if (sub.getDiscount() != null) {

                    invoice.setDiscountApplied(true);
                    invoice.setAmount((long) (invoice.getAmount() +
                                                ((sub.getSubscriptionPlan().getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8))) - sub.getDiscount().getAmount())));

                } else {

                    invoice.setAmount((long) (invoice.getAmount() + sub.getSubscriptionPlan().getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8))));
                }

                logger.info("Plan Price to Sats for month: " + invoice.getAmount() + " in USD : " + invoice.getAmountUsd());

                groupedInvoice.put(sub.getUserId(), invoice);
                sub.setInvoiceCreated(true);
                updatedSubs.add(sub);

            }

        }

        invoiceRepository.saveAll(groupedInvoice.values());
        subscriptionRepository.saveAll(updatedSubs);

        for (Invoice i : groupedInvoice.values()){
            String message = "<h2>Hi %s</h2><br> <p>your subscription payment is due and an invoice has been generated for you. Please pay to continue using our diverse features</p><br><p>Regards";
            message = String.format(message, i.getSubscriptions().get(0).getFirstName());

            sendSubscribedEmail(message,"Payment Reminder",
                    i.getSubscriptions().get(0).getFirstName(), i.getSubscriptions().get(0).getEmail());

        }



    }

    public void handleSubscriptionPaymentByInvoice(String rHash, boolean isSettled, String settleIndex) {

        if (!isSettled)
            return;

        LndInvoice lndInvoice = lndInvoiceRepository.findByHashStr(rHash).orElse(null);

        if (lndInvoice == null)
            return;

        lndInvoice.setSettledIndex(settleIndex);
        lndInvoice.setPaid(true);
        lndInvoiceRepository.save(lndInvoice);

        Invoice invoice = invoiceRepository.findByPaymentMethodId(lndInvoice.getUniqueID()).orElse(null);

        if (invoice == null)
            return;

        invoice.setStatus(InvoiceStatus.SETTLED);
        invoiceRepository.save(invoice);

        BitcoinPrice bitcoinPrice = bitcoinPriceRepository.getLatestPrice();

        List<Payment> paymentsToCreate = new ArrayList<>();

        for (Subscription s : invoice.getSubscriptions()){

            Calendar cal = createCalendarWithZeroTime();
            cal.setTime(s.getExpiry());

            cal.add(Calendar.MONTH, 1);
            cal.set(Calendar.DAY_OF_MONTH, 1);
            cal.add(Calendar.DATE, -1);

            Payment payment = new Payment();
            payment.setNode(s.getNodeId());
            payment.setProduct(s.getProduct().getProductName());
            payment.setStartDate(s.getExpiry());
            payment.setEndDate(cal.getTime());
            payment.setPaymentMethod(PaymentMethod.LND_INVOICE);
            payment.setAmount((long) (s.getSubscriptionPlan().getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8))));
            payment.setCurrency(s.getSubscriptionPlan().getCurrency());
            payment.setUserId(s.getUserId());

            paymentsToCreate.add(payment);

            s.setStatus(SubscriptionStatus.ACTIVE);
            s.setExpiry(cal.getTime());
            s.setInvoiceCreated(false);

            subscriptionRepository.save(s);

            String message = "<h2>Hi %s</h2><br> <p>Your LND payment was successful, your subscription has been renewed for LQwd</p><br><p>Regards";
            message = String.format(message, s.getFirstName());

            sendSubscribedEmail(message, "Payment Successful",
                    s.getFirstName(), s.getEmail());
        }

        paymentRepository.saveAll(paymentsToCreate);

    }

    public void handleSubPaymentByBTCAddress(String address, int numOfConfirmation, String amount) {

        if (subNumOfConfirmations > numOfConfirmation)
            return;

        BtcPaymentAddress btcPaymentAddress = btcPaymentAddressRepository
                .findByWalletAddress(address).orElse(null);
        if(btcPaymentAddress != null) {
            logger.info("Btc payment address is  : " + btcPaymentAddress);
        } else {
            logger.info("btc payment address is null" );
        }
        if (btcPaymentAddress == null)
            return;

        if (btcPaymentAddress.isUsed())
            return;

        Long convertedAmount = Long.parseLong(amount);

        Invoice invoice = invoiceRepository.findByPaymentMethodId(btcPaymentAddress.getWalletAddress())
                .orElse(null);
        if(invoice != null) {
            logger.info("Receiving message invoice : " + invoice.toString() + " converted amount :" + convertedAmount.toString());
        } else {
            logger.info("Receiving message invoice is null " );
        }
        if (invoice == null)
            return;

        if (convertedAmount < (btcPaymentAddress.getAmount() / 100000000))
            return;

        invoice.setStatus(InvoiceStatus.SETTLED);
        invoiceRepository.save(invoice);

        BitcoinPrice bitcoinPrice = bitcoinPriceRepository.getLatestPrice();

        List<Payment> paymentsToCreate = new ArrayList<>();

        for (Subscription s : invoice.getSubscriptions()){

            Calendar cal = createCalendarWithZeroTime();
            cal.setTime(s.getExpiry());

            cal.add(Calendar.MONTH, 1);
            cal.set(Calendar.DAY_OF_MONTH, 1);
            cal.add(Calendar.DATE, -1);

//            int field = s.getSubscriptionPlan().getFrequency()
//                    .equals(SubFrequency.MONTHLY) ? Calendar.MONTH : Calendar.YEAR;
//
//            cal.add(field, 1);

            Payment payment = new Payment();
            payment.setNode(s.getNodeId());
            payment.setProduct(s.getProduct().getProductName());
            payment.setStartDate(s.getExpiry());
            payment.setEndDate(cal.getTime());
            payment.setPaymentMethod(PaymentMethod.BTC_ADDRESS);
            payment.setAmount((long) (s.getSubscriptionPlan().getPrice()/(bitcoinPrice.getUsd()/Math.pow(10, 8))));;
            payment.setCurrency(s.getSubscriptionPlan().getCurrency());
            payment.setUserId(s.getUserId());

            paymentsToCreate.add(payment);


            s.setStatus(SubscriptionStatus.ACTIVE);
            s.setExpiry(cal.getTime());
            s.setInvoiceCreated(false);

            subscriptionRepository.save(s);


            String message = "<h2>Hi %s</h2><br> <p>Your BTC payment was successful, your subscription has been renewed for LQwd</p><br><p>Regards";
            message = String.format(message, s.getFirstName());

            sendSubscribedEmail(message, "Payment Successful",
                    s.getFirstName(), s.getEmail());
        }

        paymentRepository.saveAll(paymentsToCreate);
        btcPaymentAddress.setUsed(true);
        btcPaymentAddress.setNumberOfConf(numOfConfirmation);
        btcPaymentAddressRepository.save(btcPaymentAddress);


    }

    public void handleSubscribeRequestByInvoice(String rHash, boolean isSettled, String settleIndex) {

        if (!isSettled)
            return;

        LndInvoice lndInvoice = lndInvoiceRepository.findByHashStr(rHash).orElse(null);

        if (lndInvoice == null)
            return;

        lndInvoice.setSettledIndex(settleIndex);
        lndInvoice.setPaid(true);
        lndInvoiceRepository.save(lndInvoice);

        SubscriptionRequest sub = subscriptionRequestRepository
                .findByLndInvoiceId(lndInvoice.getUniqueID()).orElse(null);

        if (sub == null)
            return;

        Product product = productRepository.findById(sub.getProductId()).orElse(null);

        if (product == null)
            return;



        subscribe(sub, PaymentMethod.LND_INVOICE);

        kafkaMessageSender.sendSuccessSubscription(new SuccessSubscription(sub.getUserId(), sub.getNode()));

        //send notification to user
        sendSubscribeEmail(sub, product);

        subscriptionRequestRepository.delete(sub);

    }

    private void sendSubscribeEmail(SubscriptionRequest sub, Product product) {
        String message = "<h2>Thank you for your payment!</h2><p>Your %s - %s has been activated</p><p>Regards</p>";
        message = String.format(message, sub.getNode(), product.getProductName());

        sendSubscribedEmail(message, "Payment Successful",
                sub.getFirstName(), sub.getEmail());
    }

    public void handleSubscribeRequestByBTC(String address, int numOfConfirmation, String amount) {

        System.out.println("num of conf config: " + subNumOfConfirmations + " got: " + numOfConfirmation);

        if (subNumOfConfirmations > numOfConfirmation)
            return;


        BtcPaymentAddress btcPaymentAddress = btcPaymentAddressRepository
                .findByWalletAddress(address).orElse(null);

        if (btcPaymentAddress == null)
            return;

        if (btcPaymentAddress.isUsed())
            return;

        Long convertedAmount = Long.parseLong(amount);


        if (convertedAmount < (btcPaymentAddress.getAmount() / 100000000))
            return;

        SubscriptionRequest sub = subscriptionRequestRepository
                .findByLndInvoiceId(btcPaymentAddress.getWalletAddress()).orElse(null);

        if (sub == null)
            return;

        Product product = productRepository.findById(sub.getProductId()).orElse(null);

        if (product == null)
            return;


        subscribe(sub, PaymentMethod.BTC_ADDRESS);

        kafkaMessageSender.sendSuccessSubscription(new SuccessSubscription(sub.getUserId(), sub.getNode()));

        //send notification to user
        sendSubscribeEmail(sub, product);

        btcPaymentAddress.setUsed(true);
        btcPaymentAddress.setNumberOfConf(numOfConfirmation);
        btcPaymentAddressRepository.save(btcPaymentAddress);

        subscriptionRequestRepository.delete(sub);

    }

    private Calendar calendarLastDayOfMonth() {
        Calendar cal = Calendar.getInstance();
        cal.setTime(new Date());
        cal.set(Calendar.DATE, cal.getActualMaximum(Calendar.DATE));
        return setZeroTime(cal);
    }

    private Calendar calendarLastDayOfNextMonth() {
        Calendar cal = Calendar.getInstance();
        cal.setTime(new Date());
        cal.set(Calendar.MONTH, 1);
        cal.set(Calendar.DATE, cal.getActualMaximum(Calendar.DATE));
        return setZeroTime(cal);
    }

    private Calendar createCalendarWithZeroTime() {
        Calendar cal = Calendar.getInstance();
        cal.setTime(new Date());
        return setZeroTime(cal);
    }


    private Calendar setZeroTime(Calendar cal) {
        cal.set(Calendar.HOUR_OF_DAY, cal.getMinimum(Calendar.HOUR_OF_DAY));
        cal.set(Calendar.MINUTE, cal.getMinimum(Calendar.MINUTE));
        cal.set(Calendar.SECOND, cal.getMinimum(Calendar.SECOND));
        cal.set(Calendar.MILLISECOND, cal.getMinimum(Calendar.MILLISECOND));

        return cal;
    }

    private void sendSubscribedEmail(String message, String subject, String firstName, String email) {

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message);
        emailBody.setSubject(subject);

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);


        List<EmailAddress> receivers = new ArrayList<>();

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(firstName);
        receiver.setEmail(email);
        receiver.setRecipientType(RecipientType.TO);
        receivers.add(receiver);


        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);

        kafkaMessageSender.sendEmail(emailBody);

    }

    private void sendSubscriptionReminderEmail(int days, List<Subscription> subs, String email) throws IOException {

        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/sub-reminder-template.html");

        String template = IOUtils.toString(inputStream, StandardCharsets.UTF_8.name());

        String plans = subs.stream().map( s -> "<li><b>"+s.getProduct().getProductName()
                + " - " + s.getNodeId() + "</b></li>").collect(Collectors.joining());

        String modified = MessageFormat.format(template,  days, email, plans, frontendUrl+"/plans" );

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject("Payment reminder");

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);


        List<EmailAddress> receivers = new ArrayList<>();

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(email);
        receiver.setEmail(email);
        receiver.setRecipientType(RecipientType.TO);
        receivers.add(receiver);


        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);

        kafkaMessageSender.sendEmail(emailBody);

    }
}
