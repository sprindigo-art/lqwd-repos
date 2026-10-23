package com.lqwd.billing.models;

import com.lqwd.billing.enums.PaymentMethod;
import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class PaymentRequest {
    @NotNull
    private PaymentMethod method;
    @NotNull
    private Long invoiceId;
}
