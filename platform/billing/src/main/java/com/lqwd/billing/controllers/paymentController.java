package com.lqwd.billing.controllers;

import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.PaymentHistory;
import com.lqwd.billing.services.PaymentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collection;

@RestController
@RequestMapping(value = "/api")
@RequiredArgsConstructor
public class paymentController {


    private final PaymentService paymentService;

    @GetMapping(path = "/v1/payments")
    public ResponseEntity<ApiResponse> getMyPayments(@RequestHeader(HttpHeaders.AUTHORIZATION) String token,
                                                     @RequestParam String startDate,
                                                     @RequestParam String endDate ) {

        ApiResponse<Collection<PaymentHistory>> res  = paymentService
                .getMyPaymentHistory(startDate, endDate, token);

        return ResponseEntity.ok(res);

    }




}
