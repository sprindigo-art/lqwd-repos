package com.lqwd.billing.models;

import com.lqwd.billing.entities.Payment;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class PaymentHistory {
    private String date;
    private Long totalAmount = 0l;
    private List<Payment> payments = new ArrayList<>();
}
