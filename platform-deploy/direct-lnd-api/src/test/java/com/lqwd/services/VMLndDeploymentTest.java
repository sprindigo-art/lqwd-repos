package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.model.DeployNodeRequest;
import com.lqwd.model.DeployNodeResponse;
import com.lqwd.model.DestroyNodeRequest;
import com.lqwd.model.DestroyNodeResponse;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.request.CreateLndNodeRequest;
import com.lqwd.service.VmLNDDeploymentStrategy;
import org.junit.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.junit.Assert.assertEquals;

public class VMLndDeploymentTest extends AbstractTest {

    @Autowired
    private VmLNDDeploymentStrategy vmLNDDeploymentStrategy;


    @Test
    public void deployTest()  {

        DeployNodeRequest request = DeployNodeRequest.builder()
                .watchTower(false).nodeName("test-5").lndNetwork(LndNetwork.REGTEST)
                .ownersEmail("aziz@lqwd.money").nonCustodial(false).alias("VM node")
                .routingNode(false).build();
        String token = "test-token";
        CreateLndNodeRequest createLndNodeRequest = new CreateLndNodeRequest();

        DeployNodeResponse response = vmLNDDeploymentStrategy.deploy(request, createLndNodeRequest,  token);

        System.out.println(response);

        assertEquals(true,response.isSuccess());

    }

    @Test
    public void destroyTest()  {

        DestroyNodeRequest destroyNodeRequest = DestroyNodeRequest.builder()
                .instanceId("i-0b93a84c9f0e57007").nodeName("slnd-3").build();

        DestroyNodeResponse destroyNodeResponse = vmLNDDeploymentStrategy.destroy(destroyNodeRequest);

        assertEquals(true,destroyNodeResponse.isSuccess());


    }
}
