package com.lqwd.service;


import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.services.ecr.AmazonECR;
import com.amazonaws.services.ecr.AmazonECRClientBuilder;
import com.amazonaws.services.ecr.model.AuthorizationData;
import com.amazonaws.services.ecr.model.GetAuthorizationTokenRequest;
import com.amazonaws.services.ecr.model.GetAuthorizationTokenResult;
import com.lqwd.config.AppProperties;
import com.lqwd.config.KafkaConfigVariables;
import com.lqwd.config.KubernetesConfig;
import com.lqwd.config.NodeProperties;
import com.lqwd.exceptions.ServerErrorException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.interfaces.LNDDeploymentStrategy;
import com.lqwd.model.DeployNodeRequest;
import com.lqwd.model.DeployNodeResponse;
import com.lqwd.model.DestroyNodeRequest;
import com.lqwd.model.DestroyNodeResponse;
import com.lqwd.model.entities.LndConfig;
import com.lqwd.model.entities.LndNodeConfig;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.request.CreateLndNodeRequest;
import com.lqwd.model.response.MainResponse;
import com.lqwd.repository.LndNodeConfigRepository;
import io.fabric8.kubernetes.api.model.ExecAction;
import io.fabric8.kubernetes.api.model.IntOrString;
import io.fabric8.kubernetes.api.model.Lifecycle;
import io.fabric8.kubernetes.api.model.LifecycleHandler;
import io.fabric8.kubernetes.api.model.Probe;
import io.fabric8.kubernetes.api.model.Quantity;
import io.fabric8.kubernetes.api.model.SecretBuilder;
import io.fabric8.kubernetes.api.model.ServiceBuilder;
import io.fabric8.kubernetes.api.model.apps.Deployment;
import io.fabric8.kubernetes.api.model.apps.DeploymentBuilder;
import io.fabric8.kubernetes.client.Config;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClientBuilder;
import io.fabric8.kubernetes.client.KubernetesClientException;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.*;

@Service
@RequiredArgsConstructor
public class K8LNDDeploymentStrategy implements LNDDeploymentStrategy {

    Logger logger = LoggerFactory.getLogger(K8LNDDeploymentStrategy.class);

    private final AppProperties properties;
    private final KafkaConfigVariables configVariables;
    private final KubernetesConfig kubernetesConfig;

    private final LNDDatabaseHandler lndDatabaseHandler;
    private final HttpClientToken httpClientToken;
    private final NodeProperties nodeProperties;
    private final LndNodeConfigRepository lndNodeConfigRepository;

    @Value("${app.volume.claim}")
    private String volumeClaim;


    @Override
    public DeployNodeResponse deploy(DeployNodeRequest request, CreateLndNodeRequest createLndNodeRequest, String token) throws IOException {

        logger.info("request in k8LndDeploymentStrategy line 76 " + request);
        KubernetesClient client = getKubernetesClient();

        //Error for current selected port need another port number and try again
//        String portNumber = getNewNodePortNumber(request);
        if (!createK8Service(createLndNodeRequest, token,
                client)) {

            return DeployNodeResponse.builder().success(false).build();
        }

        if (!properties.getWenv().equals("development") && !updateTokenECR(properties.getLnd_namespace())) {

            return DeployNodeResponse.builder().success(false).build();
        }

        Deployment deployment = buildDeployment(request);

        client.apps().deployments().inNamespace(properties.getLnd_namespace()).resource(deployment).create();

        logger.info("Created deployment: {}", request.getNodeName());

        return DeployNodeResponse.builder().success(true).privateAddress(String.format(
                        "%s.%s", request.getNodeName(), properties.getLnd_namespace()))
                .build();
    }

//    private String getNewNodePortNumber(DeployNodeRequest request) {
//        String portNumber="0";
//
//
//        return portNumber;
//    }

    public KubernetesClient getKubernetesClient() throws IOException {
        Config config = kubernetesConfig.getKubernetesConfig();
        return new KubernetesClientBuilder().withConfig(config).build();
    }


    @Override
    public DestroyNodeResponse destroy(DestroyNodeRequest request) {

        DestroyNodeResponse response;

        try {

            KubernetesClient client = getKubernetesClient();


            destroyService(request.getNodeName(), properties.getLnd_namespace(), client);
            deleteDeployment(request.getNodeName(), properties.getLnd_namespace(), client);

            response = DestroyNodeResponse.builder().success(true).build();

        } catch (IOException e) {

            response = DestroyNodeResponse.builder().success(false)
                    .error("Error loading k8 config").build();

        } finally {
            lndDatabaseHandler.deleteLNDDatabase(request.getNodeName());
        }

        return response;

    }

    @Override
    public String getAddress(JSONObject nodeInfo) {
        return nodeInfo.getString("lndNodeName") + "." + nodeInfo.get("namespace");
    }

    

    public void destroyService(String nodeName, String namespace,
                               KubernetesClient client) {

        client.services().inNamespace(namespace).withName(nodeName).delete();

        if (!properties.getWenv().equals("development")) {
            String inodeName = "i-" + nodeName;
            client.services().inNamespace(namespace).withName(inodeName).delete();
        }
    }

    private void deleteDeployment(String nodeName, String namespace,
                                  KubernetesClient client) {

        try {

            Deployment deployment = client.apps().deployments()
                    .inNamespace(namespace).withName(nodeName).get();

            if (deployment == null)
                return;

            client.resource(deployment).delete();

        } catch (io.fabric8.kubernetes.client.KubernetesClientException ex) {
            logger.info("An error occurred when getting deployment : {}", ex.getMessage());
        }

    }

    private String getBitcoinHostBasedOnNetwork(LndNetwork network) {

        if (network.equals(LndNetwork.TESTNET)) {
            AppProperties.Credential credential = properties.getBtcd().get("testnet");
            return credential.getHost();
        } else if (network.equals(LndNetwork.REGTEST)) {
            AppProperties.Credential credential = properties.getBtcd().get("regtest");
            return credential.getHost();
        } else {
            AppProperties.Credential credential = properties.getBtcd().get("mainnet");
            return credential.getHost();
        }
    }

    /* return key if true and value if false. production and stage have the same node select parameters*/
    private String nodeSelectionParams(boolean iNeedKey) {
        if (iNeedKey) {

            String key = "eks.amazonaws.com/nodegroup";

            if (properties.getWenv().equals("development")) {
                key = "beta.kubernetes.io/os";
            }
            return key;
        } else {
            String value = "Worker-group-2";
            if (properties.getWenv().equals("development")) {
                value = "linux";
            }
            return value;
        }
    }

    private Deployment buildDeployment(DeployNodeRequest request) {
        logger.info("Build Deployment started on line 199 K8LNDDeploymentStrategy Service ");
        DeploymentBuilder builder = new DeploymentBuilder()
                .withNewMetadata()
                .withName(request.getNodeName())
                .withNamespace(properties.getLnd_namespace())
                .withLabels(Collections.singletonMap("app", request.getNodeName()))
                .endMetadata()
                .withNewSpec()

                .withNewSelector()
                .withMatchLabels(Collections.singletonMap("app", request.getNodeName()))
                .endSelector()

                .withNewTemplate()
                .withNewMetadata()
                .withLabels(Collections.singletonMap("app", request.getNodeName()))
                .endMetadata()

                .withNewSpec()

                .addToNodeSelector(nodeSelectionParams(true), nodeSelectionParams(false))

                .withNewAffinity()
                .withNewNodeAffinity()
                .addNewPreferredDuringSchedulingIgnoredDuringExecution()
                .withWeight(1)
                .withNewPreference()
                .addNewMatchExpression()
                .withKey("topology.kubernetes.io/zone")
                .addToValues("us-west-2a")
                .withOperator("In")
                .endMatchExpression()
                .endPreference()
                .endPreferredDuringSchedulingIgnoredDuringExecution()
                .endNodeAffinity()
                .endAffinity()

                .addNewContainer()
                .withName(request.getNodeName())
                .withImage(properties.getImage_path())

                .addNewEnv()
                .withName("WENV")
                .withValue(properties.getWenv())
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
                .withValue(LndConfig.getExternalIp())
                .endEnv()


                .addNewEnv()
                .withName("LND_PODNAME")
                .withValue(request.getNodeName())
                .endEnv()

                .addNewEnv()
                .withName("LND_PUBLIC_PORT")
                .withValue(request.getPort())
                .endEnv()

                .addNewEnv()
                .withName("LND_NON_CUSTODIAL_VALUE")
                .withValue(request.isNonCustodial() ? "1" : "0")
                .endEnv()

                .addNewEnv()
                .withName("KEY_SEND_ENABLED")
                .withValue(request.isKeySendEnabled() ? "1" : "0")
                .endEnv()

                .addNewEnv()
                .withName("SCENARIO")
                .withValue("lnd")
                .endEnv()

                .addNewEnv()
                .withName("USE_POSTGRES")
                .withValue(Integer.toString(1))
                .endEnv()

                .addNewEnv()
                .withName("LND_BITCOIND")
                .withValue("false")
                .endEnv()

                .addNewEnv()
                .withName("LIT_UI_PASSWORD")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LIT_UI_PASSWORD")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("WATCHTOWER")
                .withValue(String.valueOf(request.isWatchTower()))
                .endEnv()

                .addNewEnv()
                .withName("LND_NETWORK")
                .withValue(request.getLndNetwork().toString())
                .endEnv()

                .addNewEnv()
                .withName("LND_ALIAS")
                .withValue(request.getAlias())
                .endEnv()

                .addNewEnv()

                .withName("BTC_RPCUSER")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_RPCUSER")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()


                .addNewEnv()
                .withName("BTC_RPCPASS")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_RPCPASS")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("CLIENT_SECRET")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("CLIENT_SECRET")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("CLIENT_ID")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("CLIENT_ID")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("CIPHER_BASE_URL")
                .withValue(String.format("http://%s:%s", properties.getCipher_url(),
                        properties.getCipher_port()))
                .endEnv()

                .addNewEnv()
                .withName("OAUTH_BASE_URL")
                .withValue(String.format("http://%s:%s", properties.getAuth_post_url(),
                        properties.getAuth_post_port()))
                .endEnv()

                .addNewEnv()
                .withName("BTC_RPCHOST")
                .withValue(getBitcoinHostBasedOnNetwork(request.getLndNetwork()))
                .endEnv()
                .addNewEnv()

                .withName("SCHEMA_HOST")
                .withValue(configVariables.getSchemaRegistryUrl())
                .endEnv()

                .addNewEnv()
                .withName("KAFKA_PASSWORD")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_KAFKA_PASSWORD")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("KAFKA_USER")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_KAFKA_USER")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_USER")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_DB_USER")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_PASS")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_DB_PASS")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_HOST")
                .withValue(properties.getLnd_db_host())
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_PORT")
                .withValue(properties.getLnd_db_port())
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_USER_MAIN")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_DB_USER_MAIN")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_PASS_MAIN")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("LND_DB_PASS_MAIN")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_HOST_MAIN")
                .withValue(properties.getLnd_db_host_main())
                .endEnv()

                .addNewEnv()
                .withName("LND_DB_PORT_MAIN")
                .withValue(properties.getLnd_db_port_main())
                .endEnv()

                .addNewEnv()
                .withName("LND_MIN_CHANNEL_SIZE")
                .withValue(Integer.toString(properties.getLnd_min_channel_size()))
                .endEnv()

                .addNewEnv()
                .withName("KAFKA_HOST")
                .withValue(configVariables.getBootstrapServers())
                .endEnv()

                .addNewEnv()
                .withName("KAFKA_CO_TOPIC")
                .withValue(properties.getLnd_kafka_co_topic())
                .endEnv()

                .addNewEnv()
                .withName("KAFKA_CO_GROUP_ID")
                .withValue(properties.getLnd_kafka_co_group_id())
                .endEnv()

                .addNewEnv()
                .withName("KAFKA_PRO_TOPIC")
                .withValue(properties.getLnd_kafka_pro_topic())
                .endEnv()

                .addNewEnv()
                .withName("NOTIFICATION_EMAILS")
                .withValue(properties.getNode_alert_email_to())
                .endEnv()

                .addNewEnv()
                .withName("OWNER")
                .withValue(request.getOwnersEmail())
                .endEnv()

                .addNewEnv()
                .withName("LND_USER")
                .withValue(request.getUserId())
                .endEnv()

                .addNewEnv()
                .withName("TOR_ENABLE")
                .withValue(request.isTorEnable() ? "1" : "0")
                .endEnv()

                .addNewEnv()
                .withName("DEBUG")
                .withValue(properties.getLnd_debug())
                .endEnv()

                .addNewEnv()
                .withName("REDIS_HOST")
                .withValue(properties.getRedis_host())
                .endEnv()

                .addNewEnv()
                .withName("REDIS_PORT")
                .withValue(Integer.toString(properties.getRedis_port()))
                .endEnv()

                .addNewEnv()
                .withName("LND_SEED_EXP_SECONDS")
                .withValue(Long.toString(properties.getLnd_seed_exp_seconds()))
                .endEnv()


                .addNewEnv()
                .withName("REDIS_CRED")
                .withNewValueFrom()
                .withNewSecretKeyRef()
                .withName("secret")
                .withKey("REDIS_CRED")
                .endSecretKeyRef()
                .endValueFrom()
                .endEnv()

                .addNewPort()
                .withContainerPort(10009)
                .withProtocol("TCP")
                .endPort()
                .addNewPort()
                .withContainerPort(8080)
                .withProtocol("TCP")
                .endPort()
                .addNewPort()
                .withContainerPort(9735)
                .withProtocol("TCP")
                .endPort()

                .addNewVolumeMount()
                .withName("lnd")
                .withMountPath("/data")
                .endVolumeMount()
                .withImagePullPolicy("Always")
                .withTerminationMessagePolicy("File")
                .withNewResources()
                .withRequests(Collections.singletonMap("memory",
                        new Quantity(determineRequestMemory(request.isRoutingNode()))))
                .withLimits(Collections.singletonMap("memory",
                        new Quantity(determineLimitMemory(request.isRoutingNode()))))
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
                .withSecretName("secret")
                .endSecret()
                .endVolume()

                .endSpec()
                .endTemplate()
                .endSpec();

        configureReadinessProbe(builder);
        configureLifecycleEvent(builder);

        updateDeploymentForRestoration(request.getRestoreNodeName(),
                request.isRestoration(), builder);

        if (!properties.getWenv().equalsIgnoreCase("development")) {
            builder.editSpec().editTemplate().editSpec().addNewImagePullSecret()
                    .withName("dla-token")
                    .endImagePullSecret().endSpec().endTemplate().endSpec();
        }
        logger.info("Created NodeType POD ");
        return builder.build();

    }

    private io.fabric8.kubernetes.api.model.Service buildNodePorService(String port, String lndNodeName){
        String iLndNodeName = "i-" + lndNodeName;


        io.fabric8.kubernetes.api.model.Service service = new ServiceBuilder()
                .withNewMetadata()
                .withName(iLndNodeName)
                .withNamespace(properties.getLnd_namespace())
                .withLabels(Collections.singletonMap("app", lndNodeName))
                .endMetadata()
                .withNewSpec()
                .withSelector(Collections.singletonMap("app", lndNodeName))
                .addNewPort()
                .withName("tcp-9735")
                .withProtocol("TCP")
                .withPort(Integer.parseInt(port))
                .withTargetPort(new IntOrString(9735))
                .withNodePort(Integer.parseInt(port))
                .endPort()
                .withType("NodePort")
                .endSpec().build();

        return service;
    }

    public boolean createK8ServiceNodePort(CreateLndNodeRequest createLndNodeRequest, String token,
                                           KubernetesClient client) throws UnsupportedEncodingException {


        String port = createLndNodeRequest.getNodePort();
        String lndNodeName = createLndNodeRequest.getLndname();

        boolean portCreationResult = true;
        JSONObject lndNode = new JSONObject();

        while (portCreationResult) {

            io.fabric8.kubernetes.api.model.Service service = this.buildNodePorService(port, lndNodeName);

            try {

                client.services().inNamespace(properties.getLnd_namespace()).resource(service).create();
                portCreationResult = false;
                logger.info("Created NodeType service with name {}", service.getMetadata().getName());
                return true;
            } catch (Exception e) {
                logger.error("Created NodeType service Error {}", e.getMessage());
                logger.info("Port {} already in use will try get new NodePort lind 675", port);
                lndNode = this.updateNodePortIfNodePortAlreadyInUse(createLndNodeRequest, token);


                port = lndNode.getString("port");
                logger.info("New Port is {} line 680", port);
                createLndNodeRequest.setNodePort(port);
                updateLndNodeConfigParams(createLndNodeRequest);

            }
        }
        return true;
    }

    private HashMap<String, String> updateLndNodeConfigParams(CreateLndNodeRequest createLndNodeRequest) {



        AppProperties.Credential credential = properties.getBtcd()
                .get(createLndNodeRequest.getLndNetwork().toString());

        HashMap<String, String> configParam = new HashMap<>();
        configParam.put("LND_PODNAME", createLndNodeRequest.getLndname());
        configParam.put("PORT", createLndNodeRequest.getNodePort());
        configParam.put("LND_ALIAS", createLndNodeRequest.getAlias());
        configParam.put("LND_NETWORK", createLndNodeRequest.getLndNetwork().name());
        configParam.put("KEY_SEND_ENABLED", createLndNodeRequest.isKeySendEnabled() ? "1" : "0");
        configParam.put("USE_POSTGRES", String.valueOf(nodeProperties.getPostgresEnabled()));
        configParam.put("NAMESPACE", nodeProperties.getNamespace());
        configParam.put("BTC_RPCUSER", credential.getUsername());
        configParam.put("BTC_RPCPASS", credential.getPassword());
        configParam.put("BTC_RPCHOST", credential.getHost());
        configParam.put("WENV", properties.getWenv());
        configParam.put("OWNER", createLndNodeRequest.getOwnerEmail());
        configParam.put("EXTERNAL_HOST", createLndNodeRequest.getNodePort() + "." + nodeProperties.getExternalHost());
        configParam.put("EXTERNAL_IP", nodeProperties.getExternalIp());
        configParam.put("LND_MINCHAINSIZE", createLndNodeRequest.getMinChainSize());
        configParam.put("WATCHTOWER", String.valueOf(createLndNodeRequest.isWatchTower()));
        configParam.put("TOR_ENABLE", createLndNodeRequest.getTor());
        configParam.put("LND_PUBLIC_PORT", createLndNodeRequest.getNodePort());
        configParam.put("FORCE_UPDATE_CONFIG", String.valueOf(nodeProperties.getForceUpdateConfig()));
        configParam.put("SUBSCRIPTION", createLndNodeRequest.getSubscription().name());
        configParam.put("LND_USER", createLndNodeRequest.getUserId());
        configParam.put("RESTORATION_NODE", createLndNodeRequest.isRestoration() ? "1" : "0");
        configParam.put("LND_SEED_EXP_SECONDS", String.valueOf(properties.getLnd_seed_exp_seconds()));
        configParam.put("LND_NON_CUSTODIAL_VALUE", String.valueOf(nodeProperties.getNonCustodialEnabled()));
        LndNodeConfig lndNodeConfig = lndNodeConfigRepository.getLndNodeLastConfig(createLndNodeRequest.getLndname());

        lndNodeConfigRepository.updateConfigParam(configParam.toString(),lndNodeConfig.getId().intValue() );


        return configParam;
    }

    private JSONObject updateNodePortIfNodePortAlreadyInUse(CreateLndNodeRequest createLndNodeRequest, String token)
            throws JSONException, UnsupportedEncodingException {


        //lnd node create api call should check if user can create lnd node
        //we do not need to call a  different api request for this.
        MainResponse lndNodeInfo = httpClientToken.lndNodePortUpdate(createLndNodeRequest, token);
        logger.info(lndNodeInfo.toString());
        logger.info(" K8LNDDeploymentStrategy  lndNodeService java line 374 ");
        if (lndNodeInfo.getStatus() != HttpStatus.OK.value()) {

            if (lndNodeInfo.getError() == null) {
                throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                        "Cannot create lnd nodes now. Oauth2 Server error.");
            }

            JSONObject resp = new JSONObject(lndNodeInfo.getError());
            throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                    resp.getString("message")+" Oauth2 server create record for new node problem");
        }


        return new JSONObject(lndNodeInfo.getObject());
    }

    private boolean createK8ServiceClusterIp(String port, String lndNodeName,
                                             KubernetesClient client) {

        io.fabric8.kubernetes.api.model.Service service = new ServiceBuilder()
                .withNewMetadata()
                .withName(lndNodeName)
                .withNamespace(properties.getLnd_namespace())
                .withLabels(Collections.singletonMap("app", lndNodeName))
                .endMetadata()
                .withNewSpec()
                .withSelector(Collections.singletonMap("app", lndNodeName))
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
                .withName("tcp-9735")
                .withProtocol("TCP")
                .withPort(Integer.parseInt(port))
                .withTargetPort(new IntOrString(9735))
                .endPort().endSpec().build();

        client.services().inNamespace(properties.getLnd_namespace()).resource(service).create();

        logger.info("Created cluster IP service with name {}", service.getMetadata().getName());

        return true;
    }

    private boolean createK8ServiceClusterIpProduction(String port, String lndNodeName,
                                             KubernetesClient client) {

        io.fabric8.kubernetes.api.model.Service service = new ServiceBuilder()
                .withNewMetadata()
                .withName(lndNodeName)
                .withNamespace(properties.getLnd_namespace())
                .withLabels(Collections.singletonMap("app", lndNodeName))
                .endMetadata()
                .withNewSpec()
                .withSelector(Collections.singletonMap("app", lndNodeName))
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
                .endSpec().build();
        try {
            client.services().inNamespace(properties.getLnd_namespace()).resource(service).create();

            logger.info("Created cluster IP service with name {}", service.getMetadata().getName());

            return true;
        } catch (Exception e){
            logger.info("Problem with create ClusterIp Production Service {}", e.getMessage());
            return false;
        }
    }

    public boolean createK8Service(CreateLndNodeRequest createLndNodeRequest, String token,
                                   KubernetesClient client) throws UnsupportedEncodingException {
        boolean servicesCreated;

        if (properties.getWenv().equals("development")) {

            servicesCreated = createK8ServiceClusterIp(createLndNodeRequest.getNodePort(), createLndNodeRequest.getLndname(), client);

        } else {

            logger.info(" line 799 K8LNDDeploymentStrategy Node Port {} for lnd {}", createLndNodeRequest.getNodePort() , createLndNodeRequest.getLndname());
            servicesCreated = createK8ServiceNodePort(createLndNodeRequest, token, client);
            if (!servicesCreated) {
                logger.error("Creating NodePort service in kubernetes make  Error ");
                return false;
            }
            servicesCreated = createK8ServiceClusterIpProduction(createLndNodeRequest.getNodePort(), createLndNodeRequest.getLndname(), client);

            if (!servicesCreated) {
                logger.error("Creating ClusterIPPort service in kubernetes make  Error ");
                return false;
            }


        }

        return servicesCreated;

    }

    private void configureReadinessProbe(DeploymentBuilder builder) {

        ExecAction execAction = new ExecAction();
        execAction.setCommand(Arrays.asList("python3", "/root/python/lnd_readiness_probe.py"));

        Probe probe = new Probe();
        probe.setExec(execAction);
        probe.setFailureThreshold(5);
        probe.setInitialDelaySeconds(120);
        probe.setPeriodSeconds(30);
        probe.setSuccessThreshold(1);
        probe.setTimeoutSeconds(10);


        builder.editSpec().editTemplate().editSpec().editContainer(0).withReadinessProbe(probe).endContainer()
                .endSpec().endTemplate().endSpec();
    }

    private void configureLifecycleEvent(DeploymentBuilder builder) {

        ExecAction execAction = new ExecAction();
        execAction.setCommand(Arrays.asList("/bin/sh", "-c",
                "python3 /root/python/signal_handler.py >> /proc/1/fd/1"));

        LifecycleHandler handler = new LifecycleHandler();
        handler.setExec(execAction);

        Lifecycle lifecycle = new Lifecycle();
        lifecycle.setPreStop(handler);


        builder.editSpec().editTemplate().editSpec().editContainer(0).withLifecycle(lifecycle).endContainer()
                .endSpec().endTemplate().endSpec();
    }


    private void updateDeploymentForRestoration(String nodeName, boolean isRestoration,
                                                DeploymentBuilder builder) {
        if (!isRestoration)
            return;

        builder.editSpec().editTemplate().editSpec().editContainer(0)
                .addNewEnv()
                .withName("RESTORATION_NODE")
                .withValue(nodeName)
                .endEnv().endContainer().endSpec().endTemplate().endSpec();


    }

    private String determineLimitMemory(boolean isRoutingNode) {
        return isRoutingNode ? properties.getLnd_node_limit_mem().get("routing")
                : properties.getLnd_node_limit_mem().get("default");
    }

    private String determineRequestMemory(boolean isRoutingNode) {
        return isRoutingNode ? properties.getLnd_node_request_mem().get("routing")
                : properties.getLnd_node_request_mem().get("default");
    }

    public boolean updateTokenECR(String namespace) throws IOException {

        Config config = kubernetesConfig.getKubernetesConfig();
        AuthorizationData authorizationData = awsEcrToken();

        try (KubernetesClient client = getKubernetesClient()) {

            String dockerCfg = getDockerCfg(authorizationData);

            io.fabric8.kubernetes.api.model.Secret secret = new SecretBuilder()
                    .withNewMetadata()
                    .withName("dla-token")
                    .withNamespace(namespace)
                    .endMetadata()
                    .withType("kubernetes.io/dockerconfigjson")
                    .withData(Collections.singletonMap(".dockerconfigjson", dockerCfg))
                    .build();

            logger.info("Start service with name {}", secret.getMetadata().getName());

            logger.info(secret.getMetadata().toString());

            secret = client.secrets().inNamespace(namespace).resource(secret).createOrReplace();

            logger.info("Created service with name {}", secret.getMetadata().getName());

        } catch (KubernetesClientException e) {
            logger.error(e.getMessage(), e);
            return false;
        }

        return true;
    }

    private String getDockerCfg(AuthorizationData authorizationData) {
        byte[] tokenByte = Base64.getDecoder().decode(authorizationData.getAuthorizationToken());
        String tokenBase64 = new String(tokenByte);
        String user = tokenBase64.substring(0, tokenBase64.indexOf(":"));
        String password = tokenBase64.substring(tokenBase64.indexOf(":") + 1);

        String dockerCfg = String.format("{\"auths\": {\"%s\": {\"username\": \"%s\",\t\"password\": \"%s\",\"email\": \"%s\",\t\"auth\": \"%s\"}}}",
                authorizationData.getProxyEndpoint(),
                user,
                password,
                "nobody@example.com",
                authorizationData.getAuthorizationToken());
        return Base64.getEncoder().encodeToString(dockerCfg.getBytes());
    }


    public AuthorizationData awsEcrToken() {

        AWSCredentials awsCredentials = new BasicAWSCredentials(
                properties.getAws_access_key(), properties.getAws_secret_key());

        AmazonECR amazonECR = AmazonECRClientBuilder.standard().withRegion(properties.getAws_region())
                .withCredentials(new AWSStaticCredentialsProvider(awsCredentials))
                .build();

        GetAuthorizationTokenResult authorizationToken = amazonECR
                .getAuthorizationToken(new GetAuthorizationTokenRequest());

        List<AuthorizationData> authorizationData = authorizationToken.getAuthorizationData();

        return authorizationData.get(0);

    }
}
