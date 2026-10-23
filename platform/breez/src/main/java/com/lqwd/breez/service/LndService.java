package com.lqwd.breez.service;

import com.lqwd.breez.config.httpclient.lnd.*;
import com.lqwd.breez.dto.request.InvoiceCreateRequest;
import com.lqwd.breez.dto.response.InvoiceCreateResponse;
import com.lqwd.breez.exceptions.ApiException;
import com.lqwd.breez.model.LndInvoice;
import com.lqwd.breez.repository.LndInvoiceRepository;
import org.apache.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import retrofit2.Call;
import java.io.IOException;
import java.util.Base64;
import java.util.Map;

@Service
public class LndService {


    @Autowired
    LndHttpClientConfigurer clientConfigurer;

    @Autowired
    LndInvoiceRepository lndInvoiceRepository;

    public InvoiceCreateResponse createInvoice(InvoiceCreateRequest invoiceCreateRequest) {

        //set fee
        int fee = (int)((invoiceCreateRequest.getLengthInWeeks()/400) * invoiceCreateRequest.getAmount());

        //set payment address as base64 encoded value of public key
        String paymentAddress = Base64.getEncoder().encodeToString(invoiceCreateRequest.getPublicKey().getBytes());

        //make lnd call
        Map<String,Object> data = LndRequestBuilder.newInstance()
                .add("amt_paid", (int)invoiceCreateRequest.getAmount())
                .add("value",fee)
                .add("payment_addr", paymentAddress)
                .build();

        try{
            //configuring http client and making lnd http call.
            Call<InvoiceCreateResponse> retrofitCall =  clientConfigurer.returnLndClient(LndConstants.LND_NODE_NAME).createInvoice(data);
            InvoiceCreateResponse response = retrofitCall.execute().body();

            //saving invoice.
            LndInvoice invoice = LndInvoice
                    .builder()
                    .paymentAddress(response.getPayment_addr())
                    .rHash(response.getR_hash())
                    .paymentRequest(response.getPayment_request())
                    .build();

            lndInvoiceRepository.save(invoice);
            return response;
        }catch(IOException ex){
            throw new ApiException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        }
    }

}
