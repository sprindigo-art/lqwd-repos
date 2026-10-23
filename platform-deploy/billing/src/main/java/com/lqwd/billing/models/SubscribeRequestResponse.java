package com.lqwd.billing.models;

import com.lqwd.billing.enums.PaymentMethod;
import lombok.Data;

import java.util.Date;

@Data
public class SubscribeRequestResponse {
    private PaymentMethod method;
    private String paymentMedium;
    private String trackingId;
    private Long amount;
    private Date startDate;
    private Date endDate;
    private double amountUsd;
    private double rateUsd;

    @Override
    public String toString(){
        return paymentMedium + " "
                + trackingId + " "
                + Long.toString(amount) + " "
                + Double.toString(amountUsd) + " "
                + Double.toString(rateUsd) + " "
                + startDate.toString() + " "
                + endDate.toString();
    }
}
