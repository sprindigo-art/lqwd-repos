package com.lqwd.service;

import com.amazonaws.util.IOUtils;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.exceptions.NotFoundException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailAttachment;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.model.entities.Invoice;
import com.lqwd.model.entities.LspMonitorInvoice;
import com.lqwd.model.request.InvoiceToEmailRequest;
import com.lqwd.model.request.KeysendToEmailRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.repository.InvoiceRepository;
import com.lqwd.repository.LspMonitorInvoiceRepository;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpStatus;
import org.apache.http.entity.ContentType;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Example;
import org.springframework.data.domain.ExampleMatcher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class InvoiceService {

    private final InvoiceRepository invoiceRepository;

    private final LspMonitorInvoiceRepository lspInvoiceRepository;

    private final HttpClientToken httpClientToken;

    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final LndHttpClient lndHttpClient;

    private final KafkaMessageSender kafkaMessageSender;
    private final UserService userService;

    private final static Logger logger = LoggerFactory.getLogger(InvoiceService.class);


    public Invoice createLndInvoice(String paymentAddress, int amount, String routingLndNode,
                                    String nameSpace, String password) throws Exception {

        String routingNodeAddress = routingLndNode +"." + nameSpace;

        Map<String, Object> data = new HashMap<>();
        data.put("value", Integer.toString(amount));
        if (paymentAddress != null) {
            data.put("payment_addr", paymentAddress);
        }


        LNDResponse response = lndHttpClient.postRequestToLndPod("v1/invoices", routingNodeAddress,
                ContentType.APPLICATION_JSON, Optional.of(data), routingLndNode, password);

        if (response.getStatus() != 200)
            throw new BadRequestException(400, "An unexpected error occurred when creating invoice");

        logger.info("response is : {}", response.getResponse());
        JSONObject jsonObject = new JSONObject(response.getResponse());

        Invoice lndInvoice = Invoice.builder().addIndex(jsonObject.getString("add_index"))
                .paymentRequest(jsonObject.getString("payment_request"))
                .paymentAddress(jsonObject.getString("payment_addr"))
                .amt(amount)
                .nodeName(routingLndNode)
                .hashStr(jsonObject.getString("r_hash"))
                .build();

        lndInvoice = invoiceRepository.save(lndInvoice);
        return lndInvoice;
    }

    public ApiResponse<Invoice> findById(Long invoiceId){
        Invoice invoice = invoiceRepository.findById(invoiceId).orElseThrow(
                () -> new NotFoundException(401, "No invoice found with the specified Id")
        );

        return new ApiResponse<>(invoice, "Request successful");
    }

    public ApiResponse<String> sendInvoiceToEmail(InvoiceToEmailRequest request,
                                                   OAuth2Authentication authentication) throws IOException {

        MainResponse userinfo = httpClientToken.userInfo(accessTokenServiceHelper
                .getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != HttpStatus.SC_OK) {
            throw new BadRequestException(userinfo.getStatus(), "Cannot identify user making request.");
        }

        MainResponse mainResponse = userService.checkEmail(request.getEmail(), "checkemail");

        boolean isLqwdCustomer = (mainResponse.getStatus() == 200 &&
                mainResponse.getObject().equalsIgnoreCase("Email already exist"));



        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/invoice-template.html");

        String template = IOUtils.toString(inputStream);

        String firstName = UserUtil.retrieveUserFirstname(userinfo.getObject());

        String modified = MessageFormat.format(template, firstName, request.getAmount(),
                isLqwdCustomer ? "block":"none", request.getPayRequest(),
                request.getPayRequest(), "cid:0123456789");


        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject(String.format("[LQwD] Payment Request: An invoice send from %s.",
                firstName.toUpperCase()));

        EmailAttachment attachment = new EmailAttachment();
        attachment.setCid("0123456789");
        attachment.setMime("image/png");
        attachment.setContent(request.getInvoiceBase64());
        attachment.setName("qrcode");
        attachment.setInline(true);

        emailBody.setAttachments(Arrays.asList(attachment));

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(request.getEmail());
        receiver.setEmail(request.getEmail());
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);

        kafkaMessageSender.sendEmail(emailBody);

        return new ApiResponse<>("Invoice sent", "Request successful");
    }

    public ApiResponse<String> sendKeySendToEmail(KeysendToEmailRequest request,
                                                  OAuth2Authentication authentication) throws IOException {

        MainResponse userinfo = httpClientToken.userInfo(accessTokenServiceHelper
                .getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != HttpStatus.SC_OK) {
            throw new BadRequestException(userinfo.getStatus(), "Cannot identify user making request.");
        }

        boolean isLqwdCustomer = isLqwdCustomer(request.getEmail());


        InputStream inputStream = getClass()
                .getResourceAsStream("/templates/email/keysend-template.html");

        String template = IOUtils.toString(inputStream);

        String firstName = UserUtil.retrieveUserFirstname(userinfo.getObject());

        String modified = MessageFormat.format(template, firstName,
                isLqwdCustomer ? "block":"none", request.getKeySendAddress());


        EmailBody emailBody = new EmailBody();
        emailBody.setBody(modified);
        emailBody.setSubject(String.format("[LQwD] Payment Request: A Direct Payment info send from %s.",
                firstName.toUpperCase()));
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(request.getEmail());
        receiver.setEmail(request.getEmail());
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);

        kafkaMessageSender.sendEmail(emailBody);

        return new ApiResponse<>("email sent", "Request successful");
    }

    private boolean isLqwdCustomer(String email) {
        MainResponse mainResponse = userService.checkEmail(email, "checkemail");

        boolean isLqwdCustomer = (mainResponse.getStatus() == 200 &&
                mainResponse.getObject().equalsIgnoreCase("Email already exist"));
        return isLqwdCustomer;
    }

    public ApiResponse<PageResponse<LspMonitorInvoice>>retrieveUserInvoices(int pageNo, int pageSize,
                                                                String nodeName,
                                                                String state, Boolean keySend,
                                                                OAuth2Authentication authentication) {

        MainResponse userinfo = httpClientToken.userInfo(accessTokenServiceHelper
                .getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != HttpStatus.SC_OK) {
            throw new BadRequestException(userinfo.getStatus(), "Cannot identify user making request.");
        }

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        return new ApiResponse<>(findUserInvoice(pageNo,pageSize,nodeName,userId,state,keySend),
                "Request successful");
    }


    public PageResponse<LspMonitorInvoice> findUserInvoice(int pageNo, int pageSize,
                                                           String nodeName,
                                                           String userId, String state,
                                                           Boolean keySend) {

        LspMonitorInvoice lspMonitorInvoice = new LspMonitorInvoice();
        lspMonitorInvoice.setUserId(userId);
        lspMonitorInvoice.setNodeName(nodeName);
        lspMonitorInvoice.setIsKeysend(keySend);
        lspMonitorInvoice.setState(state);

        ExampleMatcher matcher = ExampleMatcher.matching().withIgnoreNullValues();
        Example<LspMonitorInvoice> exampleQuery = Example.of(lspMonitorInvoice, matcher);

        Page<LspMonitorInvoice> invoices = lspInvoiceRepository
                .findAll(exampleQuery, PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC,
                        "updated")));

        return new PageResponse<>(pageNo, pageSize, invoices.getTotalElements(), invoices.getContent()
                , invoices.getTotalPages());


    }
}
