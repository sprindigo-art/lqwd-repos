package com.lqwd.billing.services;

import com.lqwd.billing.clients.HttpClientToken;
import com.lqwd.billing.clients.LNDClient;
import com.lqwd.billing.entities.Invoice;
import com.lqwd.billing.entities.LndInvoice;
import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.LNDResponse;
import com.lqwd.billing.models.MainResponse;
import com.lqwd.billing.models.PageResponse;
import com.lqwd.billing.repositories.InvoiceRepository;
import com.lqwd.billing.util.UserUtil;
import lombok.RequiredArgsConstructor;
import org.apache.http.entity.ContentType;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class InvoiceService {

    private final InvoiceRepository invoiceRepository;

    private final HttpClientToken httpClientToken;

    private final LNDClient lndClient;

    private final Logger logger = LoggerFactory.getLogger(InvoiceService.class);




    public PageResponse<Invoice> getMyInvoices(int pageNo, int pageSize, String accessToken) {

        MainResponse userinfo = httpClientToken.userInfo(
                accessToken);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        Page<Invoice> invoices = getUserInvoice(userId, pageNo, pageSize);

        return new PageResponse<>(pageNo, pageSize, invoices.getTotalElements(), invoices.getContent()
        , invoices.getTotalPages());

    }

    private Page<Invoice> getUserInvoice(String userId, int pageNo, int pageSize){
        return invoiceRepository.findByUserId(userId, PageRequest.of(pageNo, pageSize,
                Sort.by(Sort.Direction.DESC, "dateCreated")));
    }


    public LndInvoice createLndInvoice(long amount, int expiry) throws Exception {


        Map<String, Object> data = new HashMap<>();
        data.put("value", Long.toString(amount));
        data.put("expiry", Long.toString(expiry));

        LNDResponse response = lndClient.postToLND("v1/invoices",
                ContentType.APPLICATION_JSON, Optional.of(data));

        if (response.getStatus() != 200)
            throw new BadRequestException(400, "An unexpected error occurred when creating invoice");

        logger.info("response is : {}", response.getResponse());

        JSONObject jsonObject = new JSONObject(response.getResponse());

        LndInvoice lndInvoice = LndInvoice.builder().addIndex(jsonObject.getString("add_index"))
                .paymentRequest(jsonObject.getString("payment_request"))
                .paymentAddress(jsonObject.getString("payment_addr"))
                .amt(amount)
                .uniqueID(UUID.randomUUID().toString())
                .hashStr(jsonObject.getString("r_hash"))
                .build();

        return lndInvoice;
    }

}
