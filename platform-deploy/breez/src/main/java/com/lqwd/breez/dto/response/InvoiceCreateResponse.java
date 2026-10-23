package com.lqwd.breez.dto.response;

import lombok.Data;

@Data
public class InvoiceCreateResponse {

    private String payment_request;

    private String add_index;

    private String payment_addr;

    private String r_hash;
}
