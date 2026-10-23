package com.lqwd.model.request;

import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class LndInvoiceStatusRequest {

    @NotNull
    private String paymentRequest;


}
