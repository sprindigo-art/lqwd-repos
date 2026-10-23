package com.lqwd.model.request;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.lqwd.model.enums.DeploymentType;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.enums.Subscription;
import com.lqwd.validators.NonNullFieldWhenOtherFieldHasCertainValue;
import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

@Data
@NonNullFieldWhenOtherFieldHasCertainValue.List(
    value={
        @NonNullFieldWhenOtherFieldHasCertainValue(
                field = "passphrase",
                dependentField = "isNonCustodial",
                dependentFieldValue = "true",
                message = "Passphrase is required for non custodial nodes"
        )
    }
)
public class CreateLndNodeRequest {

    private boolean watchTower;
    @NotNull
    private LndNetwork lndNetwork;
    private boolean routingNode;
    private String seed;
    private String passphrase;
    @NotBlank
    private String password;
    private boolean restoration = false;
    private String lndname;
    private boolean isExternalNode = false;
    private boolean isNonCustodial = false;
    private boolean isConfirmed = false;
    private boolean keySendEnabled = false;
    private boolean torEnable = false;
    private String alias = "lqwd-lnd"; //default
    private String minChainSize = "10000";
    private Subscription subscription = Subscription.K8_NEUTRINO; //default
    private DeploymentType deploymentType = DeploymentType.K8;
    @JsonIgnore
    private String ownerEmail;
    @JsonIgnore
    private String subTrackingId;
    @JsonIgnore
    private String userId;
    private String paymentMethod;
    private Long planId;
    private Long discountId;
    private Long productId;
    private Long nodeId;
    private String nodePort;


    public boolean getIsNonCustodial() {
        return isNonCustodial;
    }

    public boolean getIsConfirmed() {
        return isConfirmed;
    }

    public String getTor() {
        if(this.torEnable){
            return "0";
        } else {
            return "1";
        }

    }
}
