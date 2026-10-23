package com.lqwd.model.request;

import com.lqwd.model.entities.LspStaking;
import lombok.Data;

@Data
public class StakingRenewRequest {
    private String paymentRequest;
    private Integer days;
    private LspStaking.StakingType type;
    private String passphrase;
}
