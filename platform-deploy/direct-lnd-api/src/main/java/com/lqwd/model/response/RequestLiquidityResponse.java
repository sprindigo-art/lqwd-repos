package com.lqwd.model.response;

import com.lqwd.model.entities.Liquidity;
import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class RequestLiquidityResponse {
    private String paymentRequest;
    private Liquidity liquidity;
}
