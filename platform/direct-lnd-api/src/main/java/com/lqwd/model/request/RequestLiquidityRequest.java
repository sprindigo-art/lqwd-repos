package com.lqwd.model.request;

import com.lqwd.model.enums.LiquidityType;
import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

@Data
public class RequestLiquidityRequest {

    @Min(2)
    @Max(52)
    private int numberOfWeeks;

    @NotBlank
    private String pubKey;

    @NotBlank
    private String nodeAddress;

    private int amount;

    @NotNull
    private LiquidityType type;

    private String refNo;

    private String userEmail;

}
