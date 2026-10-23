package com.lqwd.billing.controllers;

import com.lqwd.billing.entities.Subscription;
import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.PaymentRequest;
import com.lqwd.billing.models.ProductPlanResponse;
import com.lqwd.billing.models.SubscribeRequest;
import com.lqwd.billing.models.SubscribeRequestResponse;
import com.lqwd.billing.services.SubscriptionRequestService;
import com.lqwd.billing.services.SubscriptionService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping(value = "/api")
@RequiredArgsConstructor
public class subscriptionController {


    private final SubscriptionService subscriptionService;
    private final SubscriptionRequestService subscriptionRequestService;
    private Logger logger = LoggerFactory.getLogger(subscriptionController.class);
    @PostMapping(path = "/v1/subscription")
    public ResponseEntity<ApiResponse<SubscribeRequestResponse>> subscribe(
            @RequestBody @Valid SubscribeRequest request,
            @RequestHeader(HttpHeaders.AUTHORIZATION) String token) throws Exception {

        SubscribeRequestResponse res  = subscriptionRequestService.subscribeRequest(request, token);
        logger.info("Subscription controller line 44" + res.toString());
        return ResponseEntity.ok(new ApiResponse(res, true,
                "Successful, your subscription will be activated when you pay"));

    }

    @PostMapping(path = "/v1/subscription/pay")
    public ResponseEntity<ApiResponse> paySubscription(@RequestBody @Valid PaymentRequest request) throws Exception {

        String res  = subscriptionService.paySubscription(request);

        return ResponseEntity.ok(new ApiResponse(res, true, "payment medium generated successful"));

    }

    @GetMapping(path = "/v1/subscription/products")
    public ResponseEntity<ApiResponse<List<ProductPlanResponse>>> getProducts() {
        return subscriptionService.getProductsApi();
    }

    @GetMapping(path = "/v1/subscription")
    public ResponseEntity<ApiResponse<List<Subscription>>> getMySubscriptions(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String token) {

        return subscriptionService.mySubscriptions(token);

    }


    @DeleteMapping(path = "/v1/subscription")
    public ResponseEntity<ApiResponse<String>> cancelSubscription(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String token,
            @RequestParam Long subscriptionId) {

        ApiResponse<String> res = subscriptionService.cancelSubscriptionApi(subscriptionId, token);

        return ResponseEntity.ok(res);


    }




}
