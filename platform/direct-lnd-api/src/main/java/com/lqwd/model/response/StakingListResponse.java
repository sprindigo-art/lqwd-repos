package com.lqwd.model.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Builder
@Data
public class StakingListResponse {
    long total;
    int startItem;
    int endItem;
    List<StakingItem> items;
}
