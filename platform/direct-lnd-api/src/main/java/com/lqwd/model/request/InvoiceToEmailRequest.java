package com.lqwd.model.request;

import lombok.Data;

@Data
public class InvoiceToEmailRequest {
    private String invoiceBase64;
    private String amount;
    private String email;
    private String invoiceAddress;
    private String payRequest;
}
