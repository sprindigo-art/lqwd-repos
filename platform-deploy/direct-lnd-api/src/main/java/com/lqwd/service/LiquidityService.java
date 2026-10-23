package com.lqwd.service;

import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.exceptions.NotFoundException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.model.entities.BtcPaymentAddress;
import com.lqwd.model.entities.BtcTransactionHash;
import com.lqwd.model.entities.Invoice;
import com.lqwd.model.entities.Liquidity;
import com.lqwd.model.entities.LndChannel;
import com.lqwd.model.entities.LspTransaction;
import com.lqwd.model.enums.LiquidityType;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.request.OpenChannelRequest;
import com.lqwd.model.request.RequestLiquidityRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.OpenChannelResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.model.response.RequestLiquidityResponse;
import com.lqwd.repository.BtcPaymentAddressRepository;
import com.lqwd.repository.BtcTransactionHashRepository;
import com.lqwd.repository.InvoiceRepository;
import com.lqwd.repository.LiquidityRepository;
import com.lqwd.repository.LndChannelRepository;
import com.lqwd.utils.EmailSenderUtil;
import com.lqwd.utils.HexUtil;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
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

import java.util.ArrayList;
import java.util.Base64;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class LiquidityService {

    private final static Logger logger = LoggerFactory.getLogger(LiquidityService.class);

    private final InvoiceRepository invoiceRepository;
    private final InvoiceService invoiceService;
    private final LndHttpClient lndHttpClient;
    private final LndChannelRepository lndChannelRepository;
    private final LiquidityRepository liquidityRepository;
    private final HttpClientToken httpClientToken;
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final KafkaMessageSender kafkaMessageSender;
    private final AppProperties properties;
    private final BtcAddressService btcAddressService;

    private final NodeUtilService nodeUtilService;
    private final BtcPaymentAddressRepository btcPaymentAddressRepository;
    private final BtcTransactionHashRepository btcTransactionHashRepository;


    final double staticPercentage = 0.5;

    private double calculatePercentageFee(int numberOfWeeks) {
        double percent = (numberOfWeeks / 2) * staticPercentage;
        return percent / 100;
    }

    private int calculateAmountFromFeePaid(int fee, double percentageFee) {
        return (int)(fee/percentageFee);
    }

    // fee = percentage * amount
    // fee = percentage * x
    // fee/percentage = x
    //1000/


    public ApiResponse<RequestLiquidityResponse> requestLiquidity(RequestLiquidityRequest request) throws Exception {

        if (request.getRefNo() == null)
            throw new BadRequestException(400, "Oops, unfortunately a reference number is required for this request");

        return makeLiquidityRequest(request, request.getRefNo());
    }

    public ApiResponse<RequestLiquidityResponse> requestLiquidity(RequestLiquidityRequest request,
                                                                  OAuth2Authentication authentication) throws Exception {

        MainResponse userinfo = httpClientToken.userInfo(
                accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());
        String userEmail = UserUtil.retrieveUserEmail(userinfo.getObject());

        request.setUserEmail(userEmail);

        return makeLiquidityRequest(request, userId);

    }

    public PageResponse<Invoice> loadLiquidity(OAuth2Authentication authentication, int pageNo, int pageSize) throws JSONException {

        MainResponse userinfo = httpClientToken.userInfo(
                accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));


        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        Pageable pageable = PageRequest.of(pageNo, pageSize);
        Page<Liquidity> liquidities = liquidityRepository.findAllByUserIdAndType(userId, LiquidityType.INVOICE.name(),
                pageable);

        List<Long> invoiceIds = new ArrayList<>();

        for (Liquidity l : liquidities) {
            invoiceIds.add(l.getPaymentOptionId());
        }

        List<Invoice> invoiceList = invoiceRepository.findAllById(invoiceIds);

        return new PageResponse<>(pageNo, pageSize, liquidities.getTotalElements(), invoiceList,liquidities.getTotalPages());
    }
    public PageResponse<BtcPaymentAddress> loadLiquidityBtc(OAuth2Authentication authentication, int pageNo, int pageSize) throws JSONException {

        MainResponse userinfo = httpClientToken.userInfo(
                accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));
        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        Pageable pageable = PageRequest.of(pageNo, pageSize);
        Page<Liquidity> liquidities = liquidityRepository.findAllByUserIdAndType(userId, LiquidityType.BTC_ADDRESS.name(),
                pageable);
        List<Long> invoiceIds = new ArrayList<>();
        for (Liquidity l : liquidities) {
            invoiceIds.add(l.getPaymentOptionId());
        }
        List<BtcPaymentAddress> btcPaymentAddressList = btcPaymentAddressRepository.findAllById(invoiceIds);
        return new PageResponse<>(pageNo, pageSize, liquidities.getTotalElements(), btcPaymentAddressList,liquidities.getTotalPages());
    }
    public Invoice createLndFeeInvoiceForLiquidity(String paymentAddress,
                                                   int amount, String routingLndNode, String nameSpace, String password)
            throws Exception {

        return invoiceService.createLndInvoice(paymentAddress, amount, routingLndNode, nameSpace, password);
    }


    public ApiResponse<RequestLiquidityResponse> makeLiquidityRequest(RequestLiquidityRequest request,
                                                                      String userId) throws Exception {

        if (request.getAmount() < properties.getLiquidity_min_amount())
            throw new BadRequestException(400, String.format("Oops liquidity request can't be less than %s",
                    properties.getLiquidity_min_amount()));

        if (request.getNumberOfWeeks() % 2 > 0)
            throw new BadRequestException(400, "Number of weeks should be in multiples of two");


        String routingNodeAddress = properties.getRouting_node_name()
                + "." + properties.getRouting_node_namespace();

        if (!nodeUtilService.isNodePeered(request.getPubKey(), routingNodeAddress,properties.getRouting_node_name(),
                properties.getDefault_lnd_cipher_password())) {

            if (!nodeUtilService.peerWithNode(request.getPubKey(), properties.getRouting_node_name(),
                    routingNodeAddress, request.getNodeAddress(), null)) {
                logger.info("Failed to peer nodes");
                throw new BadRequestException(400, "An error occurred when pairing nodes, please try again");
            }

        }

        LNDResponse res = estimateFee(request.getPubKey(), request.getAmount(),
                properties.getDefault_lnd_cipher_password());

        if(res.getStatus() != 200)
            throw new BadRequestException(400, "Could not get fee estimate from LND");

        JSONObject obj = new JSONObject(res.getResponse());
        Integer estimatedTrxFee = obj.getInt("fee_sat");

        double percentageFee = calculatePercentageFee(request.getNumberOfWeeks());
        int standardFee = (int)(percentageFee * request.getAmount());

        PaymentOption option = getPaymentOption(request, standardFee + estimatedTrxFee);


        Liquidity liquidity = Liquidity.builder().requestedAmt(request.getAmount())
                .feeToPay(standardFee)
                .estimatedChannelFee(estimatedTrxFee)
                .feePercentage(percentageFee)
                .channelExpiryDate(calculateChannelExpiryDate(request.getNumberOfWeeks()))
                .durationInWeeks(request.getNumberOfWeeks()).pubkey(request.getPubKey())
                .ipAddress(request.getNodeAddress()).userId(userId).userEmail(request.getUserEmail())
                .paymentOptionId(option.paymentOptionId)
                .type(request.getType())
                .paid(false).build();


        liquidityRepository.save(liquidity);

        sendEmailNotification("New Request For Liquidity", new HashMap<String, String>() {{
            put("Node", properties.getRouting_node_name());
        }});

        return new ApiResponse<>(200, new RequestLiquidityResponse(option.paymentRequest, liquidity),
                "Liquidity request logged, please pay invoice to proceed");
    }

    private PaymentOption getPaymentOption(RequestLiquidityRequest request, int fee) throws Exception {

        PaymentOption paymentOption = new PaymentOption();

        if (request.getType().equals(LiquidityType.INVOICE)) {

            String paymentAddress = Base64.getEncoder().encodeToString(request.getPubKey().getBytes());

            Invoice lndInvoice = createLndFeeInvoiceForLiquidity(paymentAddress,
                    fee, properties.getRouting_node_name(),
                    properties.getRouting_node_namespace(), properties.getDefault_lnd_cipher_password());

            paymentOption.paymentOptionId = lndInvoice.getId();
            paymentOption.paymentRequest = lndInvoice.getPaymentRequest();

            return paymentOption;
        }

        BtcPaymentAddress btcPaymentAddress = btcAddressService.createBtcAddress(fee, properties.getRouting_node_name(),
                properties.getRouting_node_namespace(),
                properties.getDefault_lnd_cipher_password());

        paymentOption.paymentOptionId = btcPaymentAddress.getId();
        paymentOption.paymentRequest = btcPaymentAddress.getWalletAddress();

        return paymentOption;

    }

    public Liquidity approveLiquidityByInvoiceRequest(String rHash, boolean settled, String settleIndex)
            throws Exception {

        if (!settled)
            return null;

        Invoice invoice = invoiceRepository.findByHashStr(rHash).orElse(null);

        if (invoice == null)
            return null;


        Liquidity liquidity = liquidityRepository.findByPaymentOptionIdAndType(invoice.getId(),
                        LiquidityType.INVOICE)
                .orElse(null);


        if (liquidity == null)
            return null;

        if (liquidity.getPaid())
            return null;


        invoice.setSettledIndex(settleIndex);
        invoice.setPaid(true);
        invoiceRepository.save(invoice);

        liquidity.setPaid(Boolean.TRUE);
        liquidity.setFee(invoice.getAmt());
        liquidity.setAmt(liquidity.getRequestedAmt());
        liquidity = liquidityRepository.save(liquidity);


        return openLiquidityChannel(liquidity);
    }


    public Liquidity approveLiquidityByBTCAddressRequest(String nodeName,
                                                         String btcAddress, LspTransaction transaction)
            throws Exception {

        if (transaction.getNoOfConfirmations() < 1)
            return null;

        BtcPaymentAddress btcPaymentAddress = btcPaymentAddressRepository
                .findByWalletAddress(btcAddress).orElse(null);

        if (btcPaymentAddress == null)
            return null;

        Liquidity liquidity = liquidityRepository.findByPaymentOptionIdAndType(btcPaymentAddress.getId(),
                        LiquidityType.BTC_ADDRESS)
                .orElse(null);


        if (liquidity == null)
            return null;

        if (liquidity.getPaid())
            return null;

        if (transaction.getNoOfConfirmations() < properties.getMin_confirmation_liquidity_and_staking()) {

            String prefix = nodeName.split("-")[0];

            if (!btcTransactionHashRepository.existsByTrxHash(transaction.getTransactionHash())) {
                BtcTransactionHash hash = BtcTransactionHash.builder().trxHash(transaction.getTransactionHash())
                        .walletAddress(btcAddress)
                        .lndNetwork(LndNetwork.getNetworkFromPrefix(prefix))
                        .amountSat((int)transaction.getAmount())
                        .nodeName(nodeName)
                        .build();
                btcTransactionHashRepository.save(hash);
            }

            return null;

        }

        int amountPaid = getAmountPaid((int)transaction.getAmount(), liquidity);

        liquidity.setFee((int)transaction.getAmount());
        liquidity.setAmt(amountPaid);

        if(amountPaid < properties.getLiquidity_min_amount()) {
            //send failure mail and return
            liquidity.setExpired(true);
            liquidity.setError("Recalculated amount is less than min channel capacity for fee paid");
            liquidityRepository.save(liquidity);

            final String id = liquidity.getId().toString();
            final String feeToPay = liquidity.getFeeToPay().toString();

            sendAmountLessThanMinChanEmail(liquidity.getUserEmail(),"Liquidity Update",
                    new HashMap<String, String>() {{
                        put("fee", Double.toString(transaction.getAmount()));
                        put("amount", Integer.toString(amountPaid));
                        put("liquidityId", id);
                        put("feeToPay", feeToPay);
                        put("minCapacity", Integer.toString(properties.getLiquidity_min_amount()));

                    }});

            return liquidity;
        }

        liquidity.setPaid(Boolean.TRUE);
        liquidity = liquidityRepository.save(liquidity);

        //delete transaction hash if exist so cron job doesn't open multiple channels
        BtcTransactionHash hash = btcTransactionHashRepository.findByTrxHash(transaction.getTransactionHash())
                .orElse(null);

        if (hash != null)
            btcTransactionHashRepository.delete(hash);

        return openLiquidityChannel(liquidity);

    }

    private int getAmountPaid(int fee, Liquidity liquidity) {

        int amountPaid = liquidity.getRequestedAmt();

        if(liquidity.getFeeToPay() != fee){

            //calculate new liquidity amt
            amountPaid = calculateAmountFromFeePaid(fee,
                    liquidity.getFeePercentage());

        }

        return amountPaid;
    }

    public Liquidity approveLiquidityByBTCAddressRequest(BtcTransactionHash hash)
            throws Exception {

        BtcPaymentAddress btcPaymentAddress = btcPaymentAddressRepository
                .findByWalletAddress(hash.getWalletAddress()).orElse(null);

        if (btcPaymentAddress == null)
            return null;

        Liquidity liquidity = liquidityRepository.findByPaymentOptionIdAndType(btcPaymentAddress.getId(),
                        LiquidityType.BTC_ADDRESS)
                .orElse(null);


        if (liquidity == null)
            return null;

        if (liquidity.getPaid())
            return null;

        int amountPaid = getAmountPaid(hash.getAmountSat(), liquidity);

        liquidity.setFee(hash.getAmountSat());
        liquidity.setAmt(amountPaid);


        if(amountPaid < properties.getLiquidity_min_amount()) {
            //send failure mail and return
            liquidity.setExpired(true);
            liquidity.setError("Recalculated amount is less than min channel capacity for fee paid");
            liquidityRepository.save(liquidity);

            final String id = liquidity.getId().toString();
            final String feeToPay = liquidity.getFeeToPay().toString();

            sendAmountLessThanMinChanEmail(liquidity.getUserEmail(),"Liquidity Update",
                    new HashMap<String, String>() {{
                        put("fee", Double.toString(hash.getAmountSat()));
                        put("amount", Integer.toString(amountPaid));
                        put("liquidityId", id);
                        put("feeToPay", feeToPay);
                        put("minCapacity", Integer.toString(properties.getLiquidity_min_amount()));

                    }});

            return liquidity;
        }


        liquidity.setPaid(Boolean.TRUE);
        liquidity = liquidityRepository.save(liquidity);

        return openLiquidityChannel(liquidity);

    }

    public ApiResponse<Liquidity> handleFailedLiquidityChannelCreation(Long liquidityID) throws Exception {

        Liquidity liquidity = liquidityRepository.findById(liquidityID).orElseThrow(
                () -> new NotFoundException(401, "No liquidity with the provided ID was found")
        );

        if (!liquidity.getPaid())
            throw new BadRequestException(400, "Oops this liquidity fee hasn't been paid yet");

        if (liquidity.getChannelId() != null)
            throw new BadRequestException(400, "Oops this liquidity already has a channel with ID: "
                    + liquidity.getChannelId());


        liquidity = openLiquidityChannel(liquidity);

        return new ApiResponse<>(liquidity, "Liquidity channel opened successfully");


    }

    private Liquidity openLiquidityChannel(Liquidity liquidity) throws Exception {

        LndChannel channel = openChannelToUserNode(liquidity, properties.getDefault_lnd_cipher_password());

        String paymentAmt = Integer.toString(liquidity.getAmt() + liquidity.getEstimatedChannelFee());
        String addr = liquidity.getIpAddress();

        if (channel == null) {
            logger.info("Failed to open channel b/w nodes");

            sendOpenChannelForLiquidityEmail(liquidity.getUserEmail(), "Channel Opening Failed",
                    new HashMap<String, String>() {{
                        put("amount", paymentAmt);
                        put("node", addr);

                    }}, true);

            throw new BadRequestException(400, "An error occurred when opening channel, please try again");
        }


        liquidity.setChannelId(channel.getId());
        liquidity = liquidityRepository.save(liquidity);


        sendEmailNotification("Request To Finalize Liquidity", new HashMap<String, String>() {{
            put("Node", properties.getRouting_node_name());
        }});

        sendOpenChannelForLiquidityEmail(liquidity.getUserEmail(), "Channel Opened Successfully",
                new HashMap<String, String>() {{
                    put("amount", paymentAmt);
                    put("node", addr);

                }}, false);


        return liquidity;
    }


    public LndChannel openChannelToUserNode(Liquidity liquidity, String password) throws Exception {

        OpenChannelRequest request = new OpenChannelRequest();
        request.setCapacity(liquidity.getAmt() + liquidity.getEstimatedChannelFee());
        request.setPassphrase(password);
        request.setPubKey(liquidity.getPubkey());
        request.setLndname(properties.getRouting_node_name());
        request.setNodeAddress(properties.getRouting_node_name()
                + "."+properties.getRouting_node_namespace());

        OpenChannelResponse response = nodeUtilService.openChannelToNode(request);

        if(!response.isSuccess()) {
            logger.info("An error occurred when opening channel: {}", response.getError());
            return null;
        }

        LndChannel channel = LndChannel.builder().channelExpiryDate(
                        calculateChannelExpiryDate(liquidity.getDurationInWeeks())).open(true)
                .fundingTxIdBase64(response.getFunding_txid_bytes()).outputIndex(
                        response.getOutput_index()).build();


        return lndChannelRepository.save(channel);

    }

    private Date calculateChannelExpiryDate(int noOfWeeks) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(new Date());
        calendar.add(Calendar.WEEK_OF_YEAR, noOfWeeks);
        return calendar.getTime();
    }


    public boolean closeChannel(LndChannel channel, String password) throws Exception {

        String routingNodeAddress = properties.getRouting_node_name()
                + "."+properties.getRouting_node_namespace();

        String hexString = HexUtil.base64ToHex(channel.getFundingTxIdBase64());
        String flipped = HexUtil.flipHexString(hexString);

        LNDResponse response = lndHttpClient.deleteRequestToLndPod(String.format("v1/channels/%s/%s?force=true",
                flipped, channel.getOutputIndex()), routingNodeAddress,
                Optional.empty(), properties.getRouting_node_name(), password);

        logger.info("Close channel response is : {}", response.getResponse());

        if (response.getStatus() != 200)
            return false;

        channel.setOpen(false);

        lndChannelRepository.save(channel);

        logger.info("Channel closed");

        return true;

    }

    public LNDResponse estimateFee(String pubKey, Integer amount, String password) throws Exception {

        Map<String, Object> params = new HashMap<>();
        params.put("target_conf", 6);
        params.put(String.format("AddrToAmount[%s]",pubKey), amount);
        String routingNodeAddress = properties.getRouting_node_name()
                + "."+properties.getRouting_node_namespace();

        return lndHttpClient.getRequestToLndPod("v1/transactions/fee", routingNodeAddress,
                Optional.of(params), properties.getRouting_node_name(), password);

    }

    public List<LndChannel> handleCloseLiquidity() {

        List<LndChannel> channels = lndChannelRepository.findByOpenAndChannelExpiryDateLessThan(true,
                new Date());


        List<Liquidity> listOfLiquidityToPersist = new ArrayList<>();
        List<LndChannel> closedChannels = new ArrayList<>();

        for (LndChannel channel : channels) {

            try {

                boolean isChannelClose = closeChannel(channel, properties.getDefault_lnd_cipher_password());

                if (!isChannelClose)
                    continue;

                closedChannels.add(channel);

                Liquidity liquidity = liquidityRepository.findByChannelId(channel.getId());

                if (liquidity == null)
                    continue;

                liquidity.setExpired(true);
                listOfLiquidityToPersist.add(liquidity);


                Map<String, String> map = new HashMap<String, String>() {{
                    put("amount", liquidity.getAmt().toString());
                    put("node", liquidity.getIpAddress());

                }};

                this.sendCloseChannelForLiquidityEmail(liquidity.getUserEmail(),
                        "Channel Closed Successfully", map);


            } catch (Exception e) {
                logger.info("exception on channel close: {}", e.getMessage());
            }
        }

        liquidityRepository.saveAll(listOfLiquidityToPersist);

        return closedChannels;
    }


    @Async
    public void sendOpenChannelForLiquidityEmail(String userEmail, String subject,
                                                 Map<String, String> variables, boolean isFailed) {


        String successMessage = String.format("<h2>Channel Open,</h2><br><p>A channel has been opened" +
                        " to the following node based on a liquidity request :</p><br>" +
                        "<p>Amount: %s</p><br><p>Node: %s",
                variables.get("amount"), variables.get("node"));

        String failedMessage = String.format("<h2>Could not open channel,</h2><br>" +
                        "<p>Was unable to open channel to the following node for a liquidity request.</p><br>" +
                        "<p>Amount: %s</p><br><p>Node: %s</p>",
                variables.get("amount"), variables.get("node"));


        sendEmail(userEmail, subject, isFailed ? failedMessage : successMessage);

    }


    public void sendCloseChannelForLiquidityEmail(String userEmail, String subject,
                                                  Map<String, String> variables) {

        String successMessage = String.format("<h2>Channel Closed,</h2><br><p>A channel has been closed" +
                        " to the following node based on a liquidity request :</p><br>" +
                        "<p>Amount: %s</p><br><p>Node: %s",
                variables.get("amount"), variables.get("node"));


        sendEmail(userEmail, subject, successMessage);
    }

    public void sendAmountLessThanMinChanEmail(String userEmail, String subject,
                                                  Map<String, String> variables) {

        String successMessage = String.format("<h2>An update on your liquidity request</h2>"+
                        "<p>We noticed a fee payment of %s sat was made for your liquidity request with id %s, " +
                        "because the fee paid is not equivalent to the required fee of %s sat a" +
                        " recalculation was done " +
                        "based on the fee, which resulted to an amount of %s.</p>" +
                        "<p>Unfortunately we can't open a channel to you, because this amount is " +
                        "less than our min channel capacity " +
                        "of %s sat<p>" +
                        "<br>" +
                        "<p>Thanks,<br>" +
                        "The LQwD team",variables.get("fee"),variables.get("liquidityId"),
                variables.get("feeToPay"),variables.get("amount"),
                variables.get("minCapacity"));


        sendEmail(userEmail, subject, successMessage);
    }

    private void sendEmail(String userEmail, String subject, String message) {

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message);
        emailBody.setSubject(subject);
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);


        List<EmailAddress> receivers = new ArrayList<>();

        String[] liquidityNotificationEmails = properties.getLiquidity_notification_emails().split(",");

        for (String email : liquidityNotificationEmails) {
            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName(email);
            receiver.setEmail(email);
            receiver.setRecipientType(RecipientType.TO);
            receivers.add(receiver);
        }

        if (userEmail != null) {
            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName(userEmail);
            receiver.setEmail(userEmail);
            receiver.setRecipientType(RecipientType.TO);
            receivers.add(receiver);
        }
        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);
        kafkaMessageSender.sendEmail(emailBody);
    }

    public void sendEmailNotification(String[] emails, String subject, Map<String, String> variables) {
        StringBuilder builder = new StringBuilder();
        variables.forEach((key, value) -> {
            builder.append("<b>").append(key).append("</b> : ").append(value);
        });

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(builder.toString());
        emailBody.setSubject(subject);
        emailBody.setAttachments(new ArrayList<>());

        EmailSenderUtil.createInfoEmailAddress(emails, emailBody, kafkaMessageSender);

    }


    public void sendEmailNotification(String subject, Map<String, String> variables) {
        String[] liquidityNotificationEmails = properties.getLiquidity_notification_emails().split(",");
        sendEmailNotification(liquidityNotificationEmails, subject, variables);
    }

    public PageResponse<Liquidity> getLiquidityRequests(int pageNo, int pageSize) {

        Page<Liquidity> page = liquidityRepository
                .findAllOrderByCreatedAt(PageRequest.of(pageNo,pageSize,
                        Sort.by(Sort.Direction.DESC,"date_created")));

        return new PageResponse<>(page.getNumber(),page.getSize(),
                page.getTotalElements(),page.getContent(),page.getTotalPages());


    }

    public PageResponse<Liquidity> getLiquidityRequests(int pageNo, int pageSize,
                                                        String suppliedType,
                                                        OAuth2Authentication authentication) {

        MainResponse userinfo = httpClientToken.userInfo(
                accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));


        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        LiquidityType type = suppliedType.isEmpty() ? null :
                LiquidityType.valueOf(suppliedType);

        Liquidity ex = new Liquidity();
        ex.setType(type);
        ex.setUserId(userId);
        ex.setPaid(null);
        ex.setExpired(null);

        ExampleMatcher matcher = ExampleMatcher.matching().withIgnoreNullValues();
        Example<Liquidity> exampleQuery = Example.of(ex, matcher);

        Page<Liquidity> page = liquidityRepository.findAllByUserId(userId,
                PageRequest.of(pageNo,pageSize,
                        Sort.by(Sort.Direction.DESC,"date_created")));

        return new PageResponse<>(page.getNumber(),page.getSize(),
                page.getTotalElements(),page.getContent(),page.getTotalPages());


    }

    private class PaymentOption {
        private String paymentRequest;
        private Long paymentOptionId;
    }
}
