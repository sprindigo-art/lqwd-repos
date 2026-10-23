package com.lqwd.model.request;

import com.lqwd.model.entities.LspStaking;
import lombok.Data;
@Data
public class StakingWithdrawRequest {

        private String paymentRequest;
        private String passphrase;
        private LspStaking.StakingType type;
}
