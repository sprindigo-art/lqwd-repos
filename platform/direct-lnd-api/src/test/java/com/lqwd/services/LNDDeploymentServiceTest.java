package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.DeployNodeRequest;
import com.lqwd.model.DeployNodeResponse;
import com.lqwd.model.DestroyNodeRequest;
import com.lqwd.model.DestroyNodeResponse;
import com.lqwd.model.entities.Macaroon;
import com.lqwd.model.enums.DeploymentType;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.request.CreateLndNodeRequest;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.service.EncryptService;
import com.lqwd.service.K8LNDDeploymentStrategy;
import com.lqwd.service.LNDDeploymentService;
import com.lqwd.service.LndNodeService;
import com.lqwd.service.MacaroonService;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.server.mock.KubernetesServer;
import org.junit.Rule;
import org.junit.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;

import java.util.HashMap;
import java.util.Optional;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;


public class LNDDeploymentServiceTest extends AbstractTest {


    @MockBean
    private LndNodeService lndNodeService;

    @Autowired
    private LNDDeploymentService lNDDeploymentService;

    @SpyBean
    private K8LNDDeploymentStrategy k8LNDDeploymentStrategy;

    @MockBean
    private LndHttpClient lndHttpClient;

    @MockBean
    private MacaroonService macaroonService;

    @MockBean
    private EncryptService encryptService;

    @Rule
    public KubernetesServer server = new KubernetesServer();





    @Test
    public void startLNDNodeSuccessTest() throws Exception {

        String token = "test-token", lndNodeName = "slnd-test";

        String port = "100";
        CreateLndNodeRequest createLndNodeRequest = new CreateLndNodeRequest();
        createLndNodeRequest.setWatchTower(false);
        createLndNodeRequest.setLndNetwork(LndNetwork.REGTEST);
        createLndNodeRequest.setRoutingNode(false);
        createLndNodeRequest.setNonCustodial(true);
        createLndNodeRequest.setPassphrase("Test");
        createLndNodeRequest.setDeploymentType(DeploymentType.K8);
        createLndNodeRequest.setAlias("test");
        createLndNodeRequest.setOwnerEmail("test@gmail.com");



        Mockito.doReturn(true).when(k8LNDDeploymentStrategy)
                .createK8Service(Mockito.nullable(CreateLndNodeRequest.class), Mockito.nullable(String.class),
                        any(KubernetesClient.class));

        Mockito.doReturn(DeployNodeResponse.builder().success(true).privateAddress("slnd-123.lqwd-lnd")
                        .build()).when(k8LNDDeploymentStrategy)
                .deploy(any(DeployNodeRequest.class),Mockito.nullable(CreateLndNodeRequest.class), any(String.class));

        Mockito.when(lndHttpClient.getRequestToLndPod(any(String.class), any(String.class),
                any(Optional.class),any(String.class),Mockito.nullable(String.class))).thenReturn(LNDResponse.builder()
                .response("{}")
                .status(200).build());

        Mockito.when(macaroonService.getMacaroon(any(String.class), any(String.class))).thenReturn(
                new Macaroon()
        );

        Mockito.when(encryptService.encrypt(any(byte[].class), any(String.class))).thenReturn(
                "encrypt"
        );


//        Mockito.doNothing().when(lndNodeService)
//                .updateNodeStatus(any(String.class), any(String.class),any(HashMap.class));

        lNDDeploymentService.deployAndStartLndNode( createLndNodeRequest, k8LNDDeploymentStrategy, token);


    }

    @Test
    public void startLNDNodeServiceFailedTest() throws Exception {

        String token = "test-token", lndNodeName = "slnd-test";

        String port = "100";
        CreateLndNodeRequest createLndNodeRequest = new CreateLndNodeRequest();
        createLndNodeRequest.setWatchTower(false);
        createLndNodeRequest.setLndNetwork(LndNetwork.REGTEST);
        createLndNodeRequest.setRoutingNode(false);
        createLndNodeRequest.setNonCustodial(true);
        createLndNodeRequest.setPassphrase("Test");
        createLndNodeRequest.setDeploymentType(DeploymentType.K8);
        createLndNodeRequest.setAlias("test");
        createLndNodeRequest.setOwnerEmail("test@gmail.com");


        Mockito.doReturn(server.getClient()).when(k8LNDDeploymentStrategy)
                .getKubernetesClient();


        Mockito.doReturn(false).when(k8LNDDeploymentStrategy)
                .createK8Service(Mockito.nullable(CreateLndNodeRequest.class), Mockito.nullable(String.class),
                        any(KubernetesClient.class));

        Mockito.when(lndHttpClient.getRequestToLndPod(any(String.class), any(String.class),
                any(Optional.class),any(String.class),Mockito.nullable(String.class))).thenReturn(LNDResponse.builder()
                .response("{}")
                .status(200).build());

        Mockito.when(macaroonService.getMacaroon(any(String.class), any(String.class))).thenReturn(
                new Macaroon()
        );

        Mockito.when(encryptService.encrypt(any(byte[].class), any(String.class))).thenReturn(
                "encrypt"
        );

//        Mockito.doNothing().when(lndNodeService)
//                .updateNodeStatus(any(String.class), any(String.class),any(HashMap.class));


        lNDDeploymentService.deployAndStartLndNode( createLndNodeRequest, k8LNDDeploymentStrategy, token);


    }

    @Test
    public void startLNDNodeDeploymentFailedTest() throws Exception {

        String token = "test-token", lndNodeName = "slnd-test";

        String port = "100";
        CreateLndNodeRequest createLndNodeRequest = new CreateLndNodeRequest();
        createLndNodeRequest.setWatchTower(false);
        createLndNodeRequest.setLndNetwork(LndNetwork.REGTEST);
        createLndNodeRequest.setRoutingNode(false);
        createLndNodeRequest.setNonCustodial(true);
        createLndNodeRequest.setPassphrase("Test");
        createLndNodeRequest.setDeploymentType(DeploymentType.K8);
        createLndNodeRequest.setAlias("test");
        createLndNodeRequest.setOwnerEmail("test@gmail.com");


        Mockito.doReturn(server.getClient()).when(k8LNDDeploymentStrategy)
                .getKubernetesClient();

        Mockito.doReturn(true).when(k8LNDDeploymentStrategy)
                .createK8Service(Mockito.nullable(CreateLndNodeRequest.class),Mockito.nullable(String.class),
                        any(KubernetesClient.class));

        Mockito.doReturn(DeployNodeResponse.builder().success(true).build()).when(k8LNDDeploymentStrategy)
                .deploy(any(DeployNodeRequest.class), Mockito.nullable(CreateLndNodeRequest.class), any(String.class));

        Mockito.when(lndHttpClient.getRequestToLndPod(any(String.class), any(String.class),
                any(Optional.class),any(String.class),Mockito.nullable(String.class))).thenReturn(LNDResponse.builder()
                .response("{}")
                .status(400).build());

        Mockito.when(macaroonService.getMacaroon(any(String.class), any(String.class))).thenReturn(
                new Macaroon()
        );

        Mockito.when(encryptService.encrypt(any(byte[].class), any(String.class))).thenReturn(
                "encrypt"
        );

//        Mockito.doNothing().when(lndNodeService)
//                .updateNodeStatus(any(String.class), any(String.class),any(HashMap.class));

        Mockito.doReturn(DestroyNodeResponse.builder().success(true).build()).when(k8LNDDeploymentStrategy)
                .destroy(any(DestroyNodeRequest.class));

        lNDDeploymentService.deployAndStartLndNode( createLndNodeRequest,k8LNDDeploymentStrategy, token);


    }

    @Test
    public void startLNDNodeNotRunningFailedTest() throws Exception {

        String token = "test-token", lndNodeName = "slnd-test";

        String port = "100";
        CreateLndNodeRequest createLndNodeRequest = new CreateLndNodeRequest();
        createLndNodeRequest.setWatchTower(false);
        createLndNodeRequest.setLndNetwork(LndNetwork.REGTEST);
        createLndNodeRequest.setRoutingNode(false);
        createLndNodeRequest.setNonCustodial(true);
        createLndNodeRequest.setPassphrase("Test");
        createLndNodeRequest.setAlias("test");
        createLndNodeRequest.setDeploymentType(DeploymentType.K8);
        createLndNodeRequest.setOwnerEmail("test@gmail.com");


        Mockito.doReturn(true).when(k8LNDDeploymentStrategy)
                .createK8Service(Mockito.nullable(CreateLndNodeRequest.class), Mockito.nullable(String.class),
                        any(KubernetesClient.class));

        Mockito.doReturn(DeployNodeResponse.builder().success(true).build()).when(k8LNDDeploymentStrategy)
                .deploy(any(DeployNodeRequest.class), Mockito.nullable(CreateLndNodeRequest.class), any(String.class));

        Mockito.when(lndHttpClient.getRequestToLndPod(any(String.class), any(String.class),
                any(Optional.class),any(String.class),Mockito.nullable(String.class))).thenReturn(LNDResponse.builder()
                .response("{}")
                .status(400).build());

        Mockito.when(macaroonService.getMacaroon(any(String.class), any(String.class))).thenReturn(
                new Macaroon()
        );

        Mockito.when(encryptService.encrypt(any(byte[].class), any(String.class))).thenReturn(
                "encrypt"
        );


        Mockito.doReturn(DestroyNodeResponse.builder().success(true).build()).when(k8LNDDeploymentStrategy)
                .destroy(any(DestroyNodeRequest.class));

//        Mockito.doNothing().when(lndNodeService)
//                .updateNodeStatus(any(String.class), any(String.class),any(HashMap.class));


        lNDDeploymentService.deployAndStartLndNode(createLndNodeRequest,k8LNDDeploymentStrategy, token);


    }






}