package com.lqwd.billing.services;

import com.lqwd.billing.models.NodeInfoResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class PaymentNodeService {


    @Value("${app.invoice-lnd.pub-key}")
    private String macaroon;
    @Value("${app.invoice-lnd.lnd-address}")
    private String lndAddress;



    public NodeInfoResponse paymentNodeInfo() {

        return new NodeInfoResponse(lndAddress, macaroon);

    }

}
