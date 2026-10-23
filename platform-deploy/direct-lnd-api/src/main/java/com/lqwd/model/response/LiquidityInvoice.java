package com.lqwd.model.response;

import lombok.*;

import java.util.Date;

@Builder
@Data
@AllArgsConstructor
public class LiquidityInvoice
{
    int amount;
    int fee;
    int noOfWeeks;
    Date dateCreated;
    String status;
    String pubkey;
    String ipAddress;
    String invoice;

}
