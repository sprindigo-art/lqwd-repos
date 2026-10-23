package com.lqwd.model.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;

import java.util.Date;
import java.util.List;

@Builder
@Data
@AllArgsConstructor
public class LiquidityInvoiceResponse
{
    long total;
    List<LiquidityInvoice> invoices;
}
