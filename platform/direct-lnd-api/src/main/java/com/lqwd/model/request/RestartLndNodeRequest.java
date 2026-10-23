package com.lqwd.model.request;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.lqwd.model.enums.DeploymentType;
import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class RestartLndNodeRequest {

    private String passphrase;
    @NotNull
    private String lndname;

    @JsonIgnore
    private DeploymentType deploymentType;
    @JsonIgnore
    private String instanceId;


}
