package com.lqwd.breez.dto.request;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class InvoiceCreateRequest {
    double amount;
    int lengthInWeeks;
    String publicKey;
}
