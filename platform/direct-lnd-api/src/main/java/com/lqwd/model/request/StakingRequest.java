package com.lqwd.model.request;

import com.lqwd.model.entities.LspStaking;
import com.lqwd.validators.staking.ValidStakingRequest;
import lombok.Data;

@Data
@ValidStakingRequest
public class StakingRequest {

    Integer amount;

    Integer days;

    private String pubKey;

    private String ipAddress;

    private LspStaking.StakingType type;

    private String passphrase;
}
