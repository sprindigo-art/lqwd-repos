package com.lqwd.service;

import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.model.entities.BtcPaymentAddress;
import com.lqwd.model.entities.BtcTransactionHash;
import com.lqwd.model.entities.Invoice;
import com.lqwd.model.entities.LspStaking;
import com.lqwd.model.entities.LspTransaction;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.request.StakingRenewRequest;
import com.lqwd.model.request.StakingRequest;
import com.lqwd.model.request.StakingWithdrawRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.model.response.RequestStakingResponse;
import com.lqwd.model.response.StakingItem;
import com.lqwd.model.response.StakingListResponse;
import com.lqwd.repository.BtcPaymentAddressRepository;
import com.lqwd.repository.BtcTransactionHashRepository;
import com.lqwd.repository.InvoiceRepository;
import com.lqwd.repository.LspStakingRepository;
import com.lqwd.utils.EmailSenderUtil;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpStatus;
import org.json.JSONException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Example;
import org.springframework.data.domain.ExampleMatcher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.scheduling.annotation.Async;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
public class StakingService {

    private final LspStakingRepository lspStakingRepository;
    private final BtcPaymentAddressRepository btcPaymentAddressRepository;
    private final HttpClientToken httpClientToken;
    private final BtcAddressService btcAddressService;
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final InvoiceService invoiceService;
    private final KafkaMessageSender kafkaMessageSender;
    private final InvoiceRepository invoiceRepository;
    private final AppProperties properties;
    private final BtcTransactionHashRepository btcTransactionHashRepository;


    private final static Logger logger = LoggerFactory.getLogger(StakingService.class);


    public Map<String, Object> extractStakingRequestPrerequisites(OAuth2Authentication authentication)
            throws JSONException {

        MainResponse userinfo = httpClientToken.userInfo(accessTokenServiceHelper
                .getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != HttpStatus.SC_OK) {
            throw new BadRequestException(userinfo.getStatus(), "Cannot identify user making request.");
        }


        String userId = UserUtil.retrieveUserId(userinfo.getObject());
        String userEmail = UserUtil.retrieveUserEmail(userinfo.getObject());
        String firstName = UserUtil.retrieveUserFirstname(userinfo.getObject());


        Map<String, Object> requirements = new HashMap<String, Object>();
        requirements.put("userId", userId);
        requirements.put("userEmail", userEmail);
        requirements.put("firstname", firstName);

        return requirements;
    }


    private void saveStaking(StakingRequest stakingRequest, Map<String, Object> requirements,
                             Long refId, LspStaking.StakingType type) {
        LspStaking lspStaking = LspStaking.builder()
                .days(stakingRequest.getDays())
                .userId(requirements.get("userId").toString())
                .userEmail(requirements.get("userEmail").toString())
                .userFirstname(requirements.get("firstname").toString())
                .stakingReference(refId)
                .amount(stakingRequest.getAmount())
                .stakingType(type)
                .nodeName(properties.getStaking_routing_lnd_node())
                .status(LspStaking.StakingStatus.REQUESTED.name())
                .build();
        lspStakingRepository.save(lspStaking);
    }


    /**
     * Request staking generating lnd invoice
     *
     * @param stakingRequest
     * @param requirements
     * @return
     * @throws Exception
     */

    private RequestStakingResponse requestStakingGeneratedLndInvoice(StakingRequest stakingRequest,
                                                                     Map<String, Object> requirements) throws Exception {

        Invoice invoice = invoiceService.createLndInvoice(null,
                stakingRequest.getAmount(), properties.getStaking_routing_lnd_node(),
                properties.getRouting_node_namespace(),
                properties.getDefault_lnd_cipher_password()
        );

        saveStaking(stakingRequest, requirements,
                invoice.getId(), LspStaking.StakingType.INVOICE);

        return RequestStakingResponse.builder().invoicePaymentRequest(invoice.getPaymentRequest()).build();
    }

    /**
     * Request staking via generating btc address
     *
     * @param stakingRequest
     * @param requirements
     * @return
     * @throws Exception
     */
    private RequestStakingResponse requestStakingViaGeneratedBtcAddress(StakingRequest stakingRequest,
                                                                        Map<String, Object> requirements) throws Exception {


        BtcPaymentAddress address = btcAddressService.createBtcAddress(stakingRequest.getAmount(),
                properties.getStaking_routing_lnd_node(),
                properties.getRouting_node_namespace(), properties.getDefault_lnd_cipher_password());

        saveStaking(stakingRequest, requirements, address.getId(), LspStaking.StakingType.BTCADDRESS);

        return RequestStakingResponse.builder().btcAddress(address.getWalletAddress()).build();
    }

    /**
     * Request staking
     *
     * @param stakingRequest
     * @param requirements
     * @return
     * @throws Exception
     */
    public RequestStakingResponse requestStaking(StakingRequest stakingRequest,
                                                 Map<String, Object> requirements) throws Exception {

        if (stakingRequest.getType().equals(LspStaking.StakingType.INVOICE)) {
            return requestStakingGeneratedLndInvoice(stakingRequest, requirements);
        } else {
            return requestStakingViaGeneratedBtcAddress(stakingRequest, requirements);
        }
    }

    public PageResponse<LspStaking> findAllStaking(int pageNo, int pageSize,
                                                        String suppliedType ) {


        LspStaking.StakingType type = suppliedType.isEmpty() ? null :
                LspStaking.StakingType.valueOf(suppliedType);

        LspStaking ex = new LspStaking();
        ex.setStakingType(type);

        ExampleMatcher matcher = ExampleMatcher.matching().withIgnoreNullValues()
                .withIgnorePaths("amount","days");
        Example<LspStaking> exampleQuery = Example.of(ex, matcher);

        Page<LspStaking> page = lspStakingRepository.findAll(exampleQuery,
                PageRequest.of(pageNo,pageSize, Sort.by(Sort.Direction.DESC,"created")));

        return new PageResponse<>(page.getNumber(),page.getSize(),
                page.getTotalElements(),page.getContent(), page.getTotalPages());


    }

    public StakingListResponse searchStaking(OAuth2Authentication authentication,
                                             String query, String status, int page, int total) {
        MainResponse userinfo = httpClientToken.userInfo
                (accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != HttpStatus.SC_OK) {
            throw new BadRequestException(userinfo.getStatus(), "Cannot identify user making request.");
        }
        String userId;
        try {
            userId = UserUtil.retrieveUserId(userinfo.getObject());
        } catch (JSONException e) {
            throw new BadRequestException(userinfo.getStatus(), "Cannot identify user making request.");
        }

        Pageable pageable = PageRequest.of(page, total);
        //ensure one function can handle cases if query or status is not selected
        query = query == null ? "%%" : "%" + query + "%";
        status = status == null ? "%%" : status;
        Page<Object[]> result = lspStakingRepository
                .listAllByUserAndQueryAndStatus(userId, query, status, pageable);

        List<StakingItem> items = result.stream().map((object) -> {

            String stakingType = (String) object[0];
            int amount = ((BigDecimal) object[1]).intValue();
            int days = ((BigInteger) object[2]).intValue();
            Date created = (Date) object[3];
            String stakingStatus = (String) object[4];
            String nodeName = (String) object[5];
            String walletAddress = (String) object[6];
            String paymentAddress = (String) object[7];
            String paymentRequest = (String) object[8];
            String rHash = (String) object[9];
            String paymentDate = "";
            if (object[10] != null) {
                paymentDate = object[10].toString();
            }


            Date currentDate = new Date();
            long diffInMillies = Math.abs(currentDate.getTime() - created.getTime());
            long daysLeft = days - TimeUnit.DAYS.convert(diffInMillies, TimeUnit.MILLISECONDS);
            if (daysLeft < 0) daysLeft = 0;

            StakingItem item = StakingItem.builder()
                    .status(stakingStatus)
                    .address(stakingType.equals(LspStaking.StakingType.INVOICE.name()) ? paymentAddress : walletAddress)
                    .amount(amount)
                    .type(stakingType)
                    .totalDays(days)
                    .daysLeft(daysLeft)
                    .paymentRequest(paymentRequest)
                    .rHash(rHash)
                    .datePaid(paymentDate)
                    .nodeName(nodeName)
                    .dateCreated(created)
                    .build();
            return item;

        }).collect(Collectors.toList());

        StakingListResponse response = StakingListResponse.builder()
                .items(items)
                .total(result.getTotalElements())
                .startItem(items.size() > 0 ? (page * total) + 1 : 0)
                .endItem(items.size() > 0 ? (page * total) + items.size() : 0)
                .build();
        return response;
    }

    public RequestStakingResponse renewStaking(StakingRenewRequest stakingRenewRequest,
                                               OAuth2Authentication authentication) throws Exception {


        LspStaking lspStaking = stakingRenewRequest.getType().equals(LspStaking.StakingType.INVOICE)
                ? findStakingRequestInvoiceType(stakingRenewRequest.getPaymentRequest())
                : findStakingRequestBtcAddressType(stakingRenewRequest.getPaymentRequest());

        if (lspStaking == null)
            return null;

        StakingRequest stakingRequest = new StakingRequest();
        stakingRequest.setType(lspStaking.getStakingType());
        stakingRequest.setDays(stakingRenewRequest.getDays());
        stakingRequest.setAmount((int) lspStaking.getAmount());
        stakingRequest.setPassphrase(stakingRenewRequest.getPassphrase());

        Map<String, Object> requirements = extractStakingRequestPrerequisites(authentication);

        RequestStakingResponse requestStakingResponse = requestStaking(stakingRequest, requirements);


        lspStaking.setStatus("RENEWED");
        lspStakingRepository.save(lspStaking);

        return requestStakingResponse;
    }

    public ApiResponse withdrawStaking(StakingWithdrawRequest stakingWithdrawRequest,
                                       OAuth2Authentication authentication) {

        MainResponse userinfo = httpClientToken
                .userInfo(accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != HttpStatus.SC_OK) {
            throw new BadRequestException(userinfo.getStatus(), "Cannot identify user making request.");
        }


        LspStaking lspStaking = stakingWithdrawRequest.getType().equals(LspStaking.StakingType.INVOICE)
                ? findStakingRequestInvoiceType(stakingWithdrawRequest.getPaymentRequest())
                : findStakingRequestBtcAddressType(stakingWithdrawRequest.getPaymentRequest());

        if (lspStaking == null)
            return new ApiResponse<>(400, null, "Failed to request withdraw");

        Map<String, String> data = new HashMap<>();
        data.put("paymentRequest", stakingWithdrawRequest.getPaymentRequest());
        data.put("amount", String.valueOf(lspStaking.getAmount()));
        data.put("userEmail", UserUtil.retrieveUserEmail(userinfo.getObject()));

        sendEmailNotification(properties.getStaking_withdraw_email(), "Request To Withdraw Staking", data);

        lspStaking.setStatus("WITHDREW");
        lspStakingRepository.save(lspStaking);
        return new ApiResponse<>(200, null, "Request was successful");


    }

    public void sendEmailNotification(String userEmail, String subject,
                                      Map<String, String> variables) {
        try {
            String successMessage = String.format("<h2>User requested to withdraw Staking request,</h2><br><p>Staking request info:</p><br>" +
                            "<p>Amount: %s</p><br><p>paymentRequest(invoice/address): %s</p><br><p>User email: %s</p>",
                    variables.get("amount"), variables.get("paymentRequest"), variables.get("userEmail"));

            EmailBody emailBody = new EmailBody();
            emailBody.setBody(successMessage);
            emailBody.setSubject(subject);
            emailBody.setAttachments(new ArrayList<>());

            EmailAddress sender = new EmailAddress();
            sender.setDisplayName("Info");
            sender.setEmail("info@lqwd.money");
            sender.setRecipientType(RecipientType.TO);


            List<EmailAddress> receivers = new ArrayList<>();

            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName(userEmail);
            receiver.setEmail(userEmail);
            receiver.setRecipientType(RecipientType.TO);
            receivers.add(receiver);

            emailBody.setRecipients(receivers);
            emailBody.setSender(sender);
            kafkaMessageSender.sendEmail(emailBody);
            logger.info("Email was sent successfully");

        } catch (Exception e) {
            logger.error("An error occurred while sending mail: {}", e.getMessage());
        }

    }

    private LspStaking findStakingRequestInvoiceType(String paymentRequest) {
        Optional<Invoice> invoiceOptional = invoiceRepository.findByPaymentRequest(paymentRequest);
        if (invoiceOptional.isPresent()) {
            Invoice invoice = invoiceOptional.get();
            Optional<LspStaking> lspStakingOptional = lspStakingRepository
                    .findByStakingReferenceAndStakingType(invoice.getId(), LspStaking.StakingType.INVOICE);
            if (lspStakingOptional.isPresent()) {
                LspStaking staking = lspStakingOptional.get();
                return staking;
            } else {
                logger.error("Failed to find the staking request");
            }
        } else {
            logger.error("Failed to find the invoice");
        }
        return null;
    }

    private LspStaking findStakingRequestBtcAddressType(String address) {
        Optional<BtcPaymentAddress> btcPaymentAddress = btcPaymentAddressRepository.findByWalletAddress(address);
        if (btcPaymentAddress.isPresent()) {
            Optional<LspStaking> lspStaking = lspStakingRepository
                    .findByStakingReferenceAndStakingType(btcPaymentAddress.get().getId(),
                            LspStaking.StakingType.BTCADDRESS);
            if (lspStaking.isPresent()) {
                LspStaking staking = lspStaking.get();
                return staking;
            } else {
                logger.error("Failed to find the staking request");
            }
        } else {
            logger.error("Failed to find the invoice");
        }
        return null;
    }

    public boolean approveStakingRequestByInvoice(String invoicePaymentRequest, String state) {

        Invoice invoice = invoiceRepository.findByPaymentRequest(invoicePaymentRequest).orElse(null);

        if (invoice == null)
            return false;

        LspStaking staking = lspStakingRepository
                .findByStakingReferenceAndStakingType(invoice.getId(),
                        LspStaking.StakingType.INVOICE).orElse(null
                );

        if (staking == null)
            return false;

        //check if status has not change return.
        if (staking.getStatus().equals(LspStaking.StakingStatus.getStatus(state).name()))
            return false;

        String formerStatus = staking.getStatus();

        LspStaking.StakingStatus newStatus = LspStaking.StakingStatus.getStatus(state);

        if (newStatus.equals(LspStaking.StakingStatus.PAID))
            staking.setPaymentDate(new Date());

        staking.setStatus(newStatus.name());

        lspStakingRepository.save(staking);

        Map<String, String> variables = new HashMap<>();
        variables.put("node", staking.getNodeName());
        variables.put("amount", Double.toString(staking.getAmount()));
        variables.put("trxAmount", Double.toString(staking.getAmount()));
        variables.put("userEmail", staking.getUserEmail());
        variables.put("firstname", staking.getUserFirstname());

        sendStakingStatusChangedEmail(staking, formerStatus, newStatus.name());

        if (newStatus.equals(LspStaking.StakingStatus.PAID)) {
            sendStakingSuccessEmailToUSer("Payment Received", variables);
            sendStakingEmailToAdmin("Payment Received", variables, false);
        }

        return true;

    }

    public boolean approveStakingRequestByBtcPayment(String nodeName,
                                                     LspTransaction lspTransaction, String address) {

        BtcPaymentAddress btcPaymentAddress = btcPaymentAddressRepository
                .findByWalletAddress(address).orElse(null);

        if (btcPaymentAddress == null)
            return false;

        LspStaking staking = lspStakingRepository
                .findByStakingReferenceAndStakingType(btcPaymentAddress.getId(),
                        LspStaking.StakingType.BTCADDRESS).orElse(null);

        if (staking == null)
            return false;

        Map<String, String> variables = new HashMap<>();
        variables.put("node", nodeName);
        variables.put("amount", Double.toString(staking.getAmount()));
        variables.put("trxAmount", Double.toString(lspTransaction.getAmount()));
        variables.put("userEmail", staking.getUserEmail());
        variables.put("firstname", staking.getUserFirstname());

        logger.info("current number of confirmations : {}", lspTransaction.getNoOfConfirmations());
        logger.info("transaction amount : {}", lspTransaction.getAmount());

        if(lspTransaction.getNoOfConfirmations() < 1)
            return false;


        if (lspTransaction.getNoOfConfirmations() < properties.getMin_confirmation_liquidity_and_staking()) {

               String prefix = nodeName.split("-")[0];

                if(!btcTransactionHashRepository.existsByTrxHash(lspTransaction.getTransactionHash())) {
                    BtcTransactionHash hash = BtcTransactionHash.builder()
                            .trxHash(lspTransaction.getTransactionHash()).walletAddress(address)
                            .lndNetwork(LndNetwork.getNetworkFromPrefix(prefix))
                            .amountSat((int)lspTransaction.getAmount())
                            .nodeName(nodeName)
                            .build();
                    btcTransactionHashRepository.save(hash);
                }

                return false;

        }

        staking.setStatus(LspStaking.StakingStatus.PAID.name());
        Date paymentDate = new Date(Long.parseLong(lspTransaction.getTimeStamp()) * 1000);
        staking.setPaymentDate(paymentDate);
        lspStakingRepository.save(staking);

        //send email to admin and user
        sendStakingSuccessEmailToUSer("Payment Received", variables);
        sendStakingEmailToAdmin("Payment Received", variables, false);

        if (staking.getAmount() != lspTransaction.getAmount()) {
            sendStakingEmailToAdmin("Faulty staking payment", variables, true);
        }

        return true;

    }

    public boolean approveStakingRequestByBtcPayment(BtcTransactionHash hash) {

        BtcPaymentAddress btcPaymentAddress = btcPaymentAddressRepository
                .findByWalletAddress(hash.getWalletAddress()).orElse(null);

        if (btcPaymentAddress == null)
            return false;

        LspStaking staking = lspStakingRepository
                .findByStakingReferenceAndStakingType(btcPaymentAddress.getId(),
                        LspStaking.StakingType.BTCADDRESS).orElse(null);

        if (staking == null)
            return false;

        Map<String, String> variables = new HashMap<>();
        variables.put("node", hash.getNodeName());
        variables.put("amount", Double.toString(staking.getAmount()));
        variables.put("trxAmount", Double.toString(hash.getAmountSat()));
        variables.put("userEmail", staking.getUserEmail());
        variables.put("firstname", staking.getUserFirstname());

        logger.info("transaction amount : {}",hash.getAmountSat());


        staking.setStatus(LspStaking.StakingStatus.PAID.name());
        staking.setPaymentDate(new Date());
        lspStakingRepository.save(staking);

        //send email to admin and user
        sendStakingSuccessEmailToUSer("Payment Received", variables);
        sendStakingEmailToAdmin("Payment Received", variables, false);

        if (staking.getAmount() != hash.getAmountSat()) {
            sendStakingEmailToAdmin("Faulty staking payment", variables, true);
        }

        return true;

    }

    private void sendStakingStatusChangedEmail(LspStaking staking, String formerStatus, String newStatus) {

        Map<String, String> map = Stream.of(new String[][]{
                {"Previous Status", formerStatus},
                {"New Status", newStatus},
                {"Amount", Double.toString(staking.getAmount())},
                {"Number of Days", Integer.toString(staking.getDays())}

        }).collect(Collectors.toMap(data -> data[0], data -> data[1]));

        String[] emails = {staking.getUserEmail()};

        StringBuilder builder = new StringBuilder();
        map.forEach((key, value) -> {
            builder.append("<b>").append(key).append("</b> : ").append(value + "<br>");
        });

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(builder.toString());
        emailBody.setSubject("Staking Request Status Changed");
        emailBody.setAttachments(new ArrayList<>());

        EmailSenderUtil.createInfoEmailAddress(emails, emailBody, kafkaMessageSender);

    }


    @Async
    public void sendStakingEmailToAdmin(String subject,
                                        Map<String, String> variables, boolean isFailed) {

        String successMessage = String.format("<h2>Heads up,</h2><br><p>A new staking request has been paid with details</p><br>" +
                        "<p>Amount: %s</p><br><p>Node: %s</p><br><p>User: %s</p>",
                variables.get("amount"), variables.get("node"), variables.get("userEmail"));

        String failedMessage = String.format("<h2>Heads up,</h2><br>" +
                        "<p>A new staking request was paid with discrepancy in amount, see details below.</p><br>" +
                        "<p>Staking amount: %s</p><br><p>Transaction amount: %s</p><br><p>Node: %s</p><br><p>User: %s</p>",
                variables.get("amount"), variables.get("trxAmount"), variables.get("node"), variables.get("userEmail"));


        EmailBody emailBody = new EmailBody();
        emailBody.setBody(isFailed ? failedMessage : successMessage);
        emailBody.setSubject(subject);
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        String[] liquidityNotificationEmails = properties.getLiquidity_notification_emails().split(",");

        List<EmailAddress> receivers = new ArrayList<>();
        for (String email : liquidityNotificationEmails) {
            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName(email);
            receiver.setEmail(email);
            receiver.setRecipientType(RecipientType.TO);
            receivers.add(receiver);
        }

        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);
        kafkaMessageSender.sendEmail(emailBody);

    }

    @Async
    public void sendStakingSuccessEmailToUSer(String subject, Map<String, String> variables) {

        String emailContent = String.format("<p>Dear %s</p><br><p>Your staking request has been paid, see details below.</p><br>" +
                        "<p>Amount: %s</p><br><p>Node: %s</p><br><br><p>Regards,</p><p>LQWD</p>",
                variables.get("firstname"), variables.get("amount"), variables.get("node"));

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(emailContent);
        emailBody.setSubject(subject);
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(variables.get("firstname"));
        receiver.setEmail(variables.get("userEmail"));
        receiver.setRecipientType(RecipientType.TO);


        List<EmailAddress> receivers = new ArrayList<>();
        receivers.add(receiver);


        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);
        kafkaMessageSender.sendEmail(emailBody);

    }

}
