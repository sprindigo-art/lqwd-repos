package com.lqwd.billing.controllers;

import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.SubscribeRequestResponse;
import com.lqwd.billing.services.SubscriptionRequestService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api")
@RequiredArgsConstructor
public class subscriptionRequestController {


    private final SubscriptionRequestService subscriptionRequestService;

    @GetMapping(path = "/v1/subscription_request/{node}")
    public ResponseEntity<ApiResponse<SubscribeRequestResponse>> retrieveSubscribeRequest(
            @PathVariable String node, @RequestHeader(HttpHeaders.AUTHORIZATION) String token) {

        SubscribeRequestResponse res  = subscriptionRequestService
                .retrieveSubscribeRequestByNode(node, token);

        return ResponseEntity.ok(new ApiResponse(res, true,
                "Successful, your subscription will be activated when you pay"));

    }


}
