package com.lqwd.billing.controllers;

import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.NodeInfoResponse;
import com.lqwd.billing.services.PaymentNodeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api")
@RequiredArgsConstructor
public class PaymentNodeController {


    private final PaymentNodeService paymentNodeService;

    @GetMapping(path = "/v1/node/info")
    public ResponseEntity<ApiResponse> paymentNodeInfo() {

        NodeInfoResponse res  = paymentNodeService.paymentNodeInfo();

        return ResponseEntity.ok(new ApiResponse(res, true,
                "Node Info"));

    }



}
