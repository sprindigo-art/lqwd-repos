package com.lqwd.service;

import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.services.ecr.AmazonECR;
import com.amazonaws.services.ecr.AmazonECRClientBuilder;
import com.amazonaws.services.ecr.model.AuthorizationData;
import com.amazonaws.services.ecr.model.GetAuthorizationTokenRequest;
import com.amazonaws.services.ecr.model.GetAuthorizationTokenResult;
import com.lqwd.config.KubernetesConfig;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.LndConfig;
import com.lqwd.model.User;
import com.lqwd.model.response.MainResponse;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.apps.Deployment;
import io.fabric8.kubernetes.api.model.apps.DeploymentBuilder;
import io.fabric8.kubernetes.client.*;
import io.fabric8.kubernetes.client.Config;

import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.RequestParam;

import javax.validation.Valid;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Service
public class KubernetesService {

    private static final Logger logger = LoggerFactory.getLogger(KubernetesService.class);

    @Autowired
    private KubernetesConfig kubernetesConfig;

    @Autowired
    LndConfigService lndConfigService;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    LndHttpClient lndHttpClient;

    @Autowired
    MacaroonService macaroonService;

    @Value("${app.max_lnd_node}")
    private Integer maxLndNode;

    @Value("${app.aws_secret_key}")
    private String secretKey;

    @Value("${app.aws_access_key}")
    private String accessKey;

    @Value("${app.aws_region}")
    private String awsRegion;

    @Value("${app.image_path}")
    private String image;

    @Value("${app.volume.claim}")
    private String volumeClaim;

    @Value("${app.wenv}")
    private String wenv;

    public ResponseEntity<?> ldnDestroy(@Valid User user, @RequestParam String lndnodename,  BindingResult bindingResult) throws IOException, JSONException {
        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        } else {
            String namespace = "lqwd-lnd";
            MainResponse mainResponse = httpClientToken.getToken(user);
            if (mainResponse.getStatus() == 200 && mainResponse.getError() == null) {
                JSONObject json = new JSONObject(mainResponse.getObject());
                String token = (String) json.get("access_token");
                MainResponse mainResponse1 = httpClientToken.lndNodeInfo(token, lndnodename,"/lndnode/getinfo", "LndNodeInfo");
                if(mainResponse1.getStatus() == 200) {


                    LndConfig lndConfig = lndConfigService.getLndnodeByName(lndnodename);

                    if (lndConfig == null) {

                        destroyService(lndnodename, namespace);
                        lndConfig.setStatus("destroyed");
                        lndConfigService.update(lndConfig);
                        String action = "/lndnode/saveinfo";
                        mainResponse = httpClientToken.saveLndNodeInfo(lndConfig, token, action, "LndnodeInfo");
                        return ResponseEntity.ok(mainResponse);
                    }
                }

            }
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "LND node cannot be deactivated"));
        }
    }



    public ResponseEntity<?> lndCreate(@Valid User user, @RequestParam String lnd_network, BindingResult bindingResult, boolean wachtower) throws Exception {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        } else {
            if (lnd_network != null && !(lnd_network.equals("testnet") || lnd_network.equals("mainnet")) ) {
                return ResponseEntity.status(500).body("Lnd network not exist or not mainnet/testnet");
            }
            MainResponse mainResponse = httpClientToken.getToken(user);

            if (mainResponse.getStatus() == 200 && mainResponse.getError() == null) {

                JSONObject json = new JSONObject(mainResponse.getObject());
                String token = (String) json.get("access_token");

                Integer lndNumber = httpClientToken.lndNodeCounts(token, "/lndnode/getlist", "LndNodeInfo");

                if(lndNumber >= maxLndNode){
                    return ResponseEntity.status(500).body("You have reached max number of Lnd Nodes");
                }

                String lnd_name = "slnd";
                MainResponse lndNodeInfo = httpClientToken.lndNodeCreate(token, lnd_name, "/lndnode/create", "LndNodeInfo", "creating", wachtower);
                JSONObject lndNode = new JSONObject(lndNodeInfo.getObject());
                String lndNodeName = (String) lndNode.get("lndNodeName");
                System.out.println("Lnd Node Name " + lndNodeName);
                String namespace = "lqwd-lnd";

                String awstoken = this.awsEcrToken();
                System.out.println(awstoken);
                boolean resultToken = this.updateTokenECR("lqwd-lnd", token);

                if (!resultToken) {
                    mainResponse = httpClientToken.lndNodeDelete(token, lndNodeName, "/lndnode/delete", "LndNodeInfo");
                    //return ResponseEntity.status(500).body("Ecr update error, try again later.");
                }

                boolean result = runNewService(lndNodeName, namespace);
                if (!result) {
                    mainResponse = httpClientToken.lndNodeDelete(token, lndNodeName, "/lndnode/delete", "LndNodeInfo");
                    return ResponseEntity.status(500).body("Service start error, try again later.");
                }
//                need add param
//                    name: LND_BITCOIND  value: "false"
//                    name: LND_NETWORK   value: testnet

                runNewDeploymentLnd(lndNodeName, namespace, lnd_network, wachtower);
                if (!result) {
                    //                   add remove service if
                    mainResponse = httpClientToken.lndNodeDelete(token, lndNodeName, "/lndnode/delete", "LndNodeInfo");
                    return ResponseEntity.status(500).body("Deployment start error, try again later.");
                }

                TimeUnit.SECONDS.sleep(60);

                boolean indicator = true;
                int ccount = 1;
                String lndContent = null;
                while (indicator) {
                    TimeUnit.SECONDS.sleep(10);
                    String macaroonFileName = "admin.macaroon";
                    String macaroon = macaroonService.getMacaroonKey(macaroonFileName, lndNodeName);
                    if (macaroon != null) {
                        lndContent = lndHttpClient.getRequestToLndPod("v1/getinfo", lndNodeName, namespace);
                        try {
                            JSONObject jsonLnd = new JSONObject(lndContent);
                            if (jsonLnd.has("identity_pubkey")) {
                                String indetityPubkey = (String) jsonLnd.get("identity_pubkey");
                                mainResponse = httpClientToken.lndNodeUpdate(token, lndNodeName, "/lndnode/update", "LndNodeInfo", "running", indetityPubkey);
                                return ResponseEntity.ok(mainResponse);
                            }
                        } catch (Exception e) {
                            System.out.println(e.getMessage());
                        }
                    }
                    ccount++;
                    if (ccount > 12) {
                        indicator = false;
                        mainResponse = httpClientToken.lndNodeDelete(token, lndNodeName, "/lndnode/delete", "LndNodeInfo");
                        if (lndContent == null) {
                            lndContent = "Service or Deployment error, connection to Node error. try again later.";
                        }
                        return ResponseEntity.status(500).body(lndContent);
                    }
                }
                mainResponse = httpClientToken.lndNodeUpdate(token, lndNodeName, "/lndnode/update", "LndNodeInfo", "running", "");

            }
            return ResponseEntity.ok(mainResponse);
        }

    }

    public boolean  runNewService(String lndNodeName, String namespace) throws IOException {

        Config config = kubernetesConfig.getKubernetesConfig();
        if(config == null){
            return false;
        }
        try (KubernetesClient client = new DefaultKubernetesClient(config)) {
            io.fabric8.kubernetes.api.model.Service service = new ServiceBuilder()
                    .withNewMetadata()
                    .withName(lndNodeName)
                    .withNamespace(namespace)
                    .withLabels(Collections.singletonMap("app", lndNodeName))
                    .endMetadata()
                    .withNewSpec()
                    .withSelector(Collections.singletonMap("app", lndNodeName))
                    .addNewPort()
                    .withName("tcp-9735")
                    .withProtocol("TCP")
                    .withPort(9735)
                    .withTargetPort(new IntOrString(9735))
                    .endPort()
                    .addNewPort()
                    .withName("tcp-10009")
                    .withProtocol("TCP")
                    .withPort(10009)
                    .withTargetPort(new IntOrString(10009))
                    .endPort()
                    .addNewPort()
                    .withName("tcp-8080")
                    .withProtocol("TCP")
                    .withPort(8080)
                    .withTargetPort(new IntOrString(8080))
                    .endPort()
                    .addNewPort()
                    .withName(String.valueOf("tcp-29088"))
                    .withProtocol("TCP")
                    .withPort(29088)
                    .withTargetPort(new IntOrString(29088))
                    .endPort()
                    .addNewPort()
                    .withName("tcp-29099")
                    .withProtocol("TCP")
                    .withPort(29099)
                    .withTargetPort(new IntOrString(29099))
                    .endPort()
                    .addNewPort()
                    .withName("tcp-853")
                    .withProtocol("TCP")
                    .withPort(853)
                    .withTargetPort(new IntOrString(853))
                    .endPort()
                    .withType("NodePort")
                    .endSpec()
                    .build();

            logger.info("Start service with name {}", service.getMetadata().getName());

            logger.info(service.getMetadata().toString());

            service = client.services().inNamespace(namespace).create(service);

            logger.info("Created service with name {}", service.getMetadata().getName());

            // String serviceURL = client.services().inNamespace(lndConfig.getNamespace()).withName(service.getMetadata().getName()).getURL(lndConfig.getPort8080());
            // logger.info("Service URL {}", serviceURL);

        } catch (KubernetesClientException e) {
            logger.error(e.getMessage(), e);
            return false;
        }
        return true;
    }


    public boolean runNewDeploymentLnd(String lndNodeName, String namespace, String lnd_network, boolean watchtower) throws IOException {
        Config config = kubernetesConfig.getKubernetesConfig();
        String rpcHost = "btc1";
        if(lnd_network.equals("testnet")){
            rpcHost="tbtc1";
        }
        if(config == null){
            return false;
        }

        try {
            Deployment deployment = new DeploymentBuilder()
                    .withNewMetadata()
                    .withName(lndNodeName)
                    .withNamespace(namespace)
                    .withLabels(Collections.singletonMap("app", lndNodeName))
                    .endMetadata()
                    .withNewSpec()

                    .withNewSelector()
                    .withMatchLabels(Collections.singletonMap("app", lndNodeName))
                    .endSelector()

                    .withNewTemplate()
                    .withNewMetadata()
                    .withLabels(Collections.singletonMap("app", lndNodeName))
                    .endMetadata()

                    .withNewSpec()
                    .addNewContainer()
                    .withName(lndNodeName)
                    .withImage(image)

                    .addNewEnv()
                    .withName("WENV")
                    .withValue(wenv)
                    .endEnv()

                    .addNewEnv()
                    .withName("POSTGRES_DB")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("POSTGRES_DB")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("POSTGRES_USER")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("POSTGRES_USER")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("POSTGRES_PASSWORD")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("POSTGRES_PASSWORD")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_PASSPHRASE")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("LND_PASSPHRASE")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_PASSWORD")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("LND_PASSWORD")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_EXTERNALIP")
                    .withValue("192.168.123.252")
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_PODNAME")
                    .withValue(lndNodeName)
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_BITCOIND")
                    .withValue("false")
                    .endEnv()

                    .addNewEnv()
                    .withName("WATCHTOWER")
                    .withValue(String.valueOf(watchtower))
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_NETWORK")
                    .withValue(lnd_network)
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_ALIAS")
                    .withValue(namespace)
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_RPCUSER")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("LND_RPCUSER")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_RPCPASS")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("LND_RPCPASS")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("ENCRYPT_KEY")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("ENCRYPT_KEY")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("ENCRYPT_ASD")
                    .withNewValueFrom()
                    .withNewSecretKeyRef()
                    .withName("secret")
                    .withKey("ENCRYPT_ASD")
                    .endSecretKeyRef()
                    .endValueFrom()
                    .endEnv()

                    .addNewEnv()
                    .withName("LND_RPCHOST")
                    .withValue(rpcHost)
                    .endEnv()

                    .addNewPort()
                    .withContainerPort(10009)
                    .withContainerPort(8080)
                    .withContainerPort(9735)
                    .withContainerPort(29088)
                    .withContainerPort(29099)
                    .endPort()

                    .addNewVolumeMount()
                    .withName("lnd")
                    .withMountPath("/data")
                    .endVolumeMount()

                    .withNewResources()
                    .withRequests(Collections.singletonMap("memory", new Quantity("1500Mi")))
//                    .withRequests(Collections.singletonMap("cpu", new Quantity("1")))
                    .withLimits(Collections.singletonMap("memory", new Quantity("2500Mi")))
//                    .withLimits(Collections.singletonMap("cpu", new Quantity("1")))
                    .endResources()
                    .endContainer()

                    .addNewVolume()
                    .withName("lnd")
                    .withNewPersistentVolumeClaim()
                    .withClaimName(volumeClaim)
                    .endPersistentVolumeClaim()
                    .endVolume()

                    .addNewVolume()
                    .withName("secret")
                    .withNewSecret()
                    .withNewSecretName("secret")
                    .endSecret()
                    .endVolume()

                    .addNewImagePullSecret()
                    .withName("ecr-token")
                    .endImagePullSecret()

                    .endSpec()
                    .endTemplate()
                    .endSpec()
                    .build();

            try (KubernetesClient client = new DefaultKubernetesClient(config)) {
                deployment = client.apps().deployments().inNamespace(namespace).create(deployment);
                logger.info("Created deployment: {}", deployment);

                logger.info("Scaling up: {}", deployment.getMetadata().getName());
                client.apps().deployments().inNamespace(namespace).withName(lndNodeName).scale(1, true);
                logger.info("Created replica sets: {}", client.apps().replicaSets().inNamespace(namespace).list().getItems());
//                logger.info("Deleting: {}", deployment.getMetadata().getName());
//                client.resource(deployment).delete();
            } catch (Exception e) {
                logger.info(e.getMessage());
                return false;
            }


        } catch (Exception e) {
            logger.info(e.getMessage());
            return false;
        }
        return true;
    }


    public boolean updateTokenECR(String namespace, String sdata) throws IOException {
        Config config = kubernetesConfig.getKubernetesConfig();

        try (KubernetesClient client = new DefaultKubernetesClient(config)) {
            client.secrets().inNamespace(namespace).withName("ecr-token").delete();
        } catch (KubernetesClientException e) {
            logger.error(e.getMessage(), e);

        }

        try (KubernetesClient client = new DefaultKubernetesClient(config)) {

            client.secrets().inNamespace(namespace).withName("ecr-token").delete();

            io.fabric8.kubernetes.api.model.Secret secret = new SecretBuilder()
                    .withNewMetadata()
                    .withName("ecr-token")
                    .withNamespace(namespace)
                    .endMetadata()
                    .withType("kubernetes.io/dockercfg")
                    .withData(Collections.singletonMap(".dockercfg", sdata))
                    .build();

            logger.info("Start service with name {}", secret.getMetadata().getName());

            logger.info(secret.getMetadata().toString());

            secret = client.secrets().inNamespace(namespace).create(secret);

            logger.info("Created service with name {}", secret.getMetadata().getName());

        } catch (KubernetesClientException e) {
            logger.error(e.getMessage(), e);
            return false;
        }

        return true;
    }


    public String awsEcrToken(){
        AWSCredentials awsCredentials = new BasicAWSCredentials(
                accessKey, secretKey);

        AmazonECR amazonECR = AmazonECRClientBuilder.standard().withRegion(awsRegion)
        .withCredentials(new AWSStaticCredentialsProvider(awsCredentials))
                .build();

        GetAuthorizationTokenResult authorizationToken = amazonECR
                .getAuthorizationToken(new GetAuthorizationTokenRequest());

        List<AuthorizationData> authorizationData = authorizationToken.getAuthorizationData();
        String encodedToken = authorizationData.get(0).getAuthorizationToken();

        byte[] tokenByte = Base64.getDecoder().decode(encodedToken);
        String token = new String(tokenByte);
        token=token.replace("AWS:", "");
        return token;
    }

    public void getPodsList() throws IOException {

        Config config3 = kubernetesConfig.getKubernetesConfig();


//        Config config = new ConfigBuilder()..build();
//
//        final ConfigBuilder configBuilder = new ConfigBuilder();
////
////        configBuilder.withMasterUrl(master);
////        configBuilder.withCaCertFile(cert);
////        configBuilder.withTrustCerts(false);
////        configBuilder.withOauthToken(token);
//
        try (KubernetesClient client = new DefaultKubernetesClient(config3)) {
            VersionInfo versionInfo = client.getVersion();

            logger.info("Version details of this Kubernetes cluster :-");
            logger.info("Major        : {}", versionInfo.getMajor());
            logger.info("Minor        : {}", versionInfo.getMinor());
            logger.info("GitVersion   : {}", versionInfo.getGitVersion());
            logger.info("BuildDate    : {}", versionInfo.getBuildDate());
            logger.info("GitTreeState : {}", versionInfo.getGitTreeState());
            logger.info("Platform     : {}", versionInfo.getPlatform());
            logger.info("GitVersion   : {}", versionInfo.getGitVersion());
            logger.info("GoVersion    : {}", versionInfo.getGoVersion());
            logger.info("GitCommit    : {}", versionInfo.getGitCommit());

            final String namespace = Optional.ofNullable(client.getNamespace()).orElse("oauth2-v1");

            System.out.println(
                    client.namespaces().list()
            );

            io.fabric8.kubernetes.api.model.Service service = new ServiceBuilder()
                    .withNewMetadata()
                    .withName("service-from-api")
                    .endMetadata()
                    .withNewSpec()
                    .withSelector(Collections.singletonMap("app", "MyApp"))
                    .addNewPort()
                    .withName("test-port")
                    .withProtocol("TCP")
                    .withPort(8110)
                    .withTargetPort(new IntOrString(8222))
                    .endPort()
                    .withType("LoadBalancer")
                    .endSpec()
                    .build();

            service = client.services().inNamespace(namespace).create(service);
            logger.info("Created service with name {}", service.getMetadata().getName());

            String serviceURL = client.services().inNamespace(namespace).withName(service.getMetadata().getName()).getURL("test-port");
            logger.info("Service URL {}", serviceURL);


//            /*
//             * 	The continue option should be set when retrieving more results from the server.
//             * 	Since this value is server defined, clients may only use the continue value from
//             * 	a previous query result with identical query parameters (except for the value of
//             * 	continue) and the server may reject a continue value it does not recognize.
//             */
//            PodList podList;
//            podList = client.pods().inNamespace(namespace).list(new ListOptionsBuilder().withLimit(5L).build());
//            podList.getItems().forEach(obj -> System.out.println(obj.getMetadata().getName()));
//
//            podList = client.pods().inNamespace(namespace)
//                    .list(new ListOptionsBuilder().withLimit(5L).withContinue(podList.getMetadata().getContinue()).build());
//            podList.getItems().forEach(obj -> System.out.println(obj.getMetadata().getName()));
//
//            Integer services = client.services().inNamespace(namespace)
//                    .list(new ListOptionsBuilder().withLimit(1L).build()).getItems().size();
//
//            client.services().inNamespace(namespace).list(new ListOptionsBuilder().withLimit(1L).withContinue(null).build());
//            System.out.println(services);


        } catch (KubernetesClientException e) {
            logger.error(e.getMessage(), e);
        }
//
//
//        try (KubernetesClient client = new DefaultKubernetesClient(config3)) {
//            VersionInfo versionInfo = client.getVersion();
//            final String namespace = Optional.ofNullable(client.getNamespace()).orElse("default");
//
//            System.out.println(
//                    client.namespaces().list()
//            );
//
//            System.out.println(
//                    client.namespaces().withLabel("this", "works").list()
//            );
//
//            System.out.println(
//                    client.pods().withLabel("this", "works").list()
//            );
//
//            System.out.println(
//                    client.pods().inNamespace("test").withLabel("this", "works").list()
//            );
//
//            System.out.println(
//                    client.pods().inNamespace("test").withName("testing").get()
//            );
//
//            /*
//             * 	The continue option should be set when retrieving more results from the server.
//             * 	Since this value is server defined, clients may only use the continue value from
//             * 	a previous query result with identical query parameters (except for the value of
//             * 	continue) and the server may reject a continue value it does not recognize.
//             */
//            PodList podList;
//            podList = client.pods().inNamespace(namespace).list(new ListOptionsBuilder().withLimit(5L).build());
//            podList.getItems().forEach(obj -> System.out.println(obj.getMetadata().getName()));
//
//            podList = client.pods().inNamespace(namespace)
//                    .list(new ListOptionsBuilder().withLimit(5L).withContinue(podList.getMetadata().getContinue()).build());
//            podList.getItems().forEach(obj -> System.out.println(obj.getMetadata().getName()));
//
//            Integer services = client.services().inNamespace(namespace)
//                    .list(new ListOptionsBuilder().withLimit(1L).build()).getItems().size();
//
//            client.services().inNamespace(namespace).list(new ListOptionsBuilder().withLimit(1L).withContinue(null).build());
//            System.out.println(services);
//        } catch (KubernetesClientException e) {
//            logger.error(e.getMessage(), e);
//        }
    }



    public boolean destroyService(String lndNodename, String namespace) throws IOException {
        Config config = kubernetesConfig.getKubernetesConfig();
        if(config == null){
            return false;
        }
        try (KubernetesClient client = new DefaultKubernetesClient(config)) {
            io.fabric8.kubernetes.api.model.Service service = client.services().inNamespace(namespace).withName(lndNodename).get();
            logger.info("GET service with name {}", service.getMetadata().getName());

            logger.info("Deleting: {}", service.getMetadata().getName());
            client.resource(service).delete();

        } catch (KubernetesClientException e) {
            logger.error(e.getMessage(), e);
            return false;
        }
        return true;
    }
}
