package com.lqwd.billing.models;

import com.lqwd.billing.enums.PaymentMethod;
import lombok.Data;

@Data
public class SubscribeRequest {
    private Long planId;
    private Long discountId;
    private Long productId;
    private String nodeName;
    private PaymentMethod method;
}
