package com.lqwd.billing.models;

import com.lqwd.billing.entities.Product;
import com.lqwd.billing.entities.SubscriptionPlan;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ProductPlanResponse {
    private Product product;
    private List<SubscriptionPlan> plans;

    public ProductPlanResponse(Product product, SubscriptionPlan plan){
        this.product = product;
        this.plans = new ArrayList<>();
        this.plans.add(plan);
    }

}
