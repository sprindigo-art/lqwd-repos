package com.lqwd.billing;

import com.lqwd.billing.entities.Discount;
import com.lqwd.billing.entities.Subscription;
import com.lqwd.billing.entities.SubscriptionRequest;
import com.lqwd.billing.enums.PaymentMethod;
import com.lqwd.billing.enums.SubscriptionStatus;
import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.ProductPlanResponse;
import com.lqwd.billing.repositories.ProductRepository;
import com.lqwd.billing.repositories.SubscriptionPlanRepository;
import com.lqwd.billing.services.SubscriptionService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

import java.util.List;

public class SubscriptionTest extends AbstractTest{

    @Autowired
    SubscriptionService subscriptionService;

    @Autowired
    SubscriptionPlanRepository subscriptionPlanRepository;

    @Autowired
    ProductRepository productRepository;

    private String userId = "ui344-4444-4442";


    @Test
    public void subscribeProductsTest(){

        ResponseEntity<ApiResponse<List<ProductPlanResponse>>> products = subscriptionService.getProductsApi();

        Assertions.assertTrue(products.getStatusCodeValue() == 200);

    }

    @Test
    public void subScribeTest(){

        ResponseEntity<ApiResponse<List<ProductPlanResponse>>> products = subscriptionService.getProductsApi();
        Discount discount = products.getBody().getData().get(0).getPlans().get(0).getDiscount();

        SubscriptionRequest subscribeRequest = new SubscriptionRequest();
        subscribeRequest.setPlanId(products.getBody().getData().get(0).getPlans().get(0).getId());
        subscribeRequest.setDiscountId(discount == null ? null : discount.getId());
        subscribeRequest.setProductId(products.getBody().getData().get(0).getProduct().getId());
        subscribeRequest.setUserId(userId);
        Subscription subscription = subscriptionService.subscribe(subscribeRequest, PaymentMethod.LND_INVOICE);

        Assertions.assertTrue(subscription.getStatus().equals(SubscriptionStatus.ACTIVE));
        Assertions.assertNotNull(subscription.getSubscriptionPlan());

    }

    @Test
    public void subScribeFailedNoPlanTest(){

        SubscriptionRequest subscribeRequest = new SubscriptionRequest();
        subscribeRequest.setPlanId(200l);
        subscribeRequest.setDiscountId(1l);
        subscribeRequest.setProductId(1l);
        subscribeRequest.setUserId("test-user-2");


        BadRequestException thrown = Assertions.assertThrows(
                BadRequestException.class,
                () -> subscriptionService.subscribe(subscribeRequest, PaymentMethod.BTC_ADDRESS),
                "Expected doThing() to throw, but it didn't"
        );

        Assertions.assertTrue(thrown.getStatus() == 400);


    }
}
