package com.lqwd.service;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.BtcPaymentAddress;
import com.lqwd.model.entities.Invoice;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.repository.BtcPaymentAddressRepository;
import com.lqwd.repository.InvoiceRepository;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpStatus;
import org.apache.http.entity.ContentType;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class BtcAddressService {

    private final BtcPaymentAddressRepository btcPaymentAddressRepository;
    private final LndHttpClient lndHttpClient;


    public BtcPaymentAddress createBtcAddress(int amount, String routingLndNode,
                                              String nameSpace, String password) throws Exception {

        String routingNodeAddress = routingLndNode+"."+nameSpace;

        LNDResponse addressResponse = lndHttpClient.getRequestToLndPod("v1/newaddress", routingNodeAddress,
                Optional.empty(), routingLndNode,
                password);

        if (addressResponse == null)
            throw new BadRequestException(HttpStatus.SC_BAD_REQUEST, "Cannot create Address. ");

        if (addressResponse.getStatus() != 200)
            throw new BadRequestException(HttpStatus.SC_BAD_REQUEST, addressResponse.getResponse());

        String uniqueAddress = new JSONObject(addressResponse.getResponse()).getString("address");

        BtcPaymentAddress btcPaymentAddress = BtcPaymentAddress.builder()
                .walletAddress(uniqueAddress)
                .amount(amount)
                .build();

        return btcPaymentAddressRepository.save(btcPaymentAddress);
    }
}
