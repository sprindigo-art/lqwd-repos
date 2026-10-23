package com.lqwd.billing.services;

import com.lqwd.billing.clients.LNDClient;
import com.lqwd.billing.entities.BtcPaymentAddress;
import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.LNDResponse;
import com.lqwd.billing.repositories.BtcPaymentAddressRepository;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpStatus;
import org.json.JSONObject;
import org.springframework.stereotype.Service;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class BtcAddressService {

    private final LNDClient lndHttpClient;


    public String createBtcAddress(long amount) throws Exception {


        LNDResponse addressResponse = lndHttpClient.getRequestToLndPod("v1/newaddress",
                Optional.empty());

        if (addressResponse == null)
            throw new BadRequestException(HttpStatus.SC_BAD_REQUEST, "Cannot create Address. ");

        if (addressResponse.getStatus() != 200)
            throw new BadRequestException(HttpStatus.SC_BAD_REQUEST, addressResponse.getResponse());

       return new JSONObject(addressResponse.getResponse()).getString("address");


    }
}
