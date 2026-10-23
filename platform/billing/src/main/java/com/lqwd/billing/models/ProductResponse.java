package com.lqwd.billing.models;

import com.lqwd.billing.entities.Discount;
import com.lqwd.billing.entities.Product;
import com.lqwd.billing.entities.SubscriptionPlan;
import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class ProductResponse {
    private Product product;
    private SubscriptionPlan subscriptionPlan;

}
