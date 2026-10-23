package com.lqwd.model.response;

import lombok.Builder;
import lombok.Data;

import java.util.Date;

@Builder
@Data
public class StakingItem {
    String address;
    int amount;
    String status;
    String datePaid;
    int totalDays;
    long daysLeft;
    String type;
    String paymentRequest;
    String nodeName;
    String rHash;
    Date dateCreated;
}

