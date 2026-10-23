package com.lqwd.factories;

import com.lqwd.interfaces.LNDDeploymentStrategy;
import com.lqwd.model.enums.DeploymentType;
import com.lqwd.service.K8LNDDeploymentStrategy;
import com.lqwd.service.VmLNDDeploymentStrategy;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class LNDDeploymentStrategyFactory {

    private final K8LNDDeploymentStrategy k8LNDDeploymentStrategy;
    private final VmLNDDeploymentStrategy vmLNDDeploymentStrategy;


    public LNDDeploymentStrategy getStrategy(DeploymentType type){
        return type.equals(DeploymentType.K8) ? k8LNDDeploymentStrategy : vmLNDDeploymentStrategy;
    }


}
