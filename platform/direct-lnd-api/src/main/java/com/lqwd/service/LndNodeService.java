package com.lqwd.service;

import com.lqwd.config.AppProperties;
import com.lqwd.config.NodeProperties;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.exceptions.ServerErrorException;
import com.lqwd.factories.LNDDeploymentStrategyFactory;
import com.lqwd.httpclient.BillingHttpClient;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.interfaces.CacheStore;

import com.lqwd.interfaces.LNDDeploymentStrategy;

import com.lqwd.messaging.schemas.NodeStatus;
import com.lqwd.messaging.schemas.SubscriptionAction;
import com.lqwd.model.DeployNodeResponse;

import com.lqwd.model.DeployLNDPlus;

import com.lqwd.model.entities.LndCreationStatusLog;
import com.lqwd.model.entities.LndNodeConfig;
import com.lqwd.model.entities.LndNodeStatus;
import com.lqwd.model.entities.Macaroon;
import com.lqwd.model.enums.DeploymentType;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.model.request.AddLndPlusToNodeRequest;
import com.lqwd.model.request.ConfirmLndNodeRequest;
import com.lqwd.model.request.CreateLndNodeRequest;
import com.lqwd.model.request.RestartLndNodeRequest;
import com.lqwd.model.request.RestartLndRequest;
import com.lqwd.model.request.UnlockLndNodeRequest;
import com.lqwd.model.response.MainResponse;
import com.lqwd.repository.LndCreationStatusLogRepository;
import com.lqwd.repository.LndNodeConfigRepository;
import com.lqwd.repository.LndNodeStatusRepository;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.StringReader;
import java.io.UnsupportedEncodingException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
public class LndNodeService {

    private static final Logger logger = LoggerFactory.getLogger(LndNodeService.class);

    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final HttpClientToken httpClientToken;
    private final LNDDeploymentService lndDeploymentService;
    private final MacaroonService macaroonService;
    private final CacheStore cacheStore;
    private final AppProperties appProperties;
    private final EncryptService encryptService;
    private final K8LNDPlusDeployment k8LNDPlusDeployment;
    private final LndCreationStatusLogRepository lndCreationStatusLogRepository;
    private final AppProperties properties;
    private final NodeProperties nodeProperties;
    private final LndNodeStatusRepository lndNodeStatusRepository;
    private final LndNodeConfigRepository lndNodeConfigRepository;

    private final LNDDeploymentStrategyFactory lndDeploymentStrategyFactory;

    private final KafkaMessageSender kafkaMessageSender;

    private final BillingHttpClient billingHttpClient;


    public MainResponse createLndNode(CreateLndNodeRequest createLndNodeRequest,
                                      OAuth2Authentication authentication) throws JSONException, UnsupportedEncodingException {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        JSONObject lndNode = createNodeOnAuthServer(createLndNodeRequest, token);

        createLndNodeRequest.setOwnerEmail(lndNode.getString("ownerEmail"));
        createLndNodeRequest.setNodeId(lndNode.getLong("id"));
        createLndNodeRequest.setLndname(lndNode.getString("lndNodeName"));
        createLndNodeRequest.setUserId(lndNode.getString("userId"));
        createLndNodeRequest.setNodePort(lndNode.getString("port"));

        createLndNodeConfigParams(createLndNodeRequest);

        return handleNodeCreation(createLndNodeRequest, token, lndNode);
    }


    public MainResponse createLndNodeV2(CreateLndNodeRequest createLndNodeRequest,
                                        OAuth2Authentication authentication) throws Exception {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.authenticate(createLndNodeRequest.getPassword(), token);

        if (response.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

        JSONObject lndNode = createNodeOnAuthServer(createLndNodeRequest, token);


        createLndNodeRequest.setOwnerEmail(lndNode.getString("ownerEmail"));
        createLndNodeRequest.setNodeId(lndNode.getLong("id"));
        createLndNodeRequest.setLndname(lndNode.getString("lndNodeName"));
        createLndNodeRequest.setUserId(lndNode.getString("userId"));
        createLndNodeRequest.setNodePort(lndNode.getString("port"));

        createLndNodeConfigParams(createLndNodeRequest);

        logger.info(" LndNodeService createLndNodeV2 ,request is : {}  Node parameters saved in Config Table {} ", createLndNodeRequest, lndNode);
        return handleNodeCreationV2(createLndNodeRequest, token, lndNode);
    }


    private HashMap<String, String> createLndNodeConfigParams(CreateLndNodeRequest createLndNodeRequest) {



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
        LndNodeConfig lndNodeConfig = new LndNodeConfig();
        lndNodeConfig.setLndNodeName(createLndNodeRequest.getLndname());
        lndNodeConfig.setStatus("CREATING");
        lndNodeConfig.setVersion("1.0");
        lndNodeConfig.setConfigParam(configParam.toString());

        lndNodeConfigRepository.save(lndNodeConfig);


        return configParam;
    }


    public MainResponse restartNode(RestartLndNodeRequest request, OAuth2Authentication authentication) {
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse response = httpClientToken.lndNodeInfo(token, request.getLndname(), "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, "Cannot handle this request");

        CreateLndNodeRequest createLndNodeRequest = new CreateLndNodeRequest();

        //filling out required parameters for creating lnd deployment on k8s
        createLndNodeRequest.setLndname(request.getLndname());
        String port;
        String userId;
        try {
            JSONObject jsonData = new JSONObject(response.getObject());
            Boolean isNonCustodial = jsonData.getBoolean("isNonCustodial");

            if (isNonCustodial) {
                if (request.getPassphrase() == null) {
                    throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),
                            "For non custodial nodes you need to provide passphrase");
                }
            }
            createLndNodeRequest.setOwnerEmail((String) jsonData.get("ownerEmail"));
            createLndNodeRequest.setLndNetwork(LndNetwork.valueOf((String) jsonData.get("network")));

            if (jsonData.has("alias")) {
                createLndNodeRequest.setAlias((String) jsonData.get("alias"));
            }

            createLndNodeRequest.setWatchTower(jsonData.getBoolean("watchtower"));
            createLndNodeRequest.setRoutingNode(jsonData.getBoolean("isRoutingNode"));

            createLndNodeRequest.setNonCustodial(isNonCustodial);

            if (isNonCustodial) {
                createLndNodeRequest.setPassphrase(request.getPassphrase());
            }

            userId = jsonData.getString("userId");
            port = jsonData.getString("port");
            String deploymentType = jsonData.getString("deploymentType");
            Object instanceId = jsonData.get("instanceId");

            request.setInstanceId(instanceId != null ? instanceId.toString() : null);
            request.setDeploymentType(DeploymentType.valueOf(deploymentType));


        } catch (JSONException e) {
            return new MainResponse(response.getStatus(), null, "Cannot handle this request from try-catch create dla lnd node service");
        }

        lndDeploymentService.deleteAndRestartNode(token, request, port, userId, createLndNodeRequest);


        return new MainResponse(200, "SuccessResponse",
                "Lnd node is restarting");
    }


    public MainResponse unlockWallet(UnlockLndNodeRequest request, OAuth2Authentication authentication) {
        logger.info("handling request to unlock node : {}", request.getLndname());
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.lndNodeInfo(token, request.getLndname(), "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, "Cannot handle this request");

        JSONObject jsonData = new JSONObject(response.getObject());
        Boolean isNonCustodial = jsonData.getBoolean("isNonCustodial");
        String nodeStatus = jsonData.getString("status");
        String privateAddress = jsonData.getString("privateAddress");


        if (!isNonCustodial) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "node is not non custodial");
        }

        if (!nodeStatus.equals(LndCreationStatusLog.CREATION_STATUS.IS_AWAITING_WALLET_UNLOCK.name())) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "cannot initiate unlock node request for node with state " + nodeStatus);
        }

        String encryptedValue = encryptService.encrypt(request.getPassphrase().getBytes(), "AEAD");
        cacheStore.insert(request.getLndname() + "-passphrase", appProperties.getLnd_password_exp_seconds(),
                encryptedValue);

        //after sending password/passphrase to redis. check for when wallet is unlocked
        //then set lnd state to running

        request.setPrivateAddress(privateAddress);

        lndDeploymentService.checkWalletIsUnlocked(request, token);


        return new MainResponse(200, "SuccessResponse",
                "Wallet unlocked request initiated");
    }

    public MainResponse confirmNode(ConfirmLndNodeRequest request, OAuth2Authentication authentication) {
        logger.info("handling request to unlock node : {}", request.getLndname());
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.confirmLndNode(token, request.getLndname(),
                "/lndnode/confirm", "LndNodeInfo");

        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, response.getError());


        return new MainResponse(200, "SuccessResponse",
                response.getObject());
    }


    public MainResponse getSeed(String nodeName, OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        logger.debug(" token success ");
        MainResponse response = httpClientToken.lndNodeInfo(token, nodeName, "/lndnode/getinfo",
                "LndNodeInfo");
        logger.debug("get lnd node info success ");
        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, "Cannot handle this request");
        logger.debug("trying to get seeds form Redis " + nodeName + "-seed");
        String seed = cacheStore.retrieve(nodeName + "-seed");
        logger.debug(" seeds done ");
        if (seed == null) {
            return new MainResponse(HttpStatus.BAD_REQUEST.value(), null, "Cannot get seed");
        }
        return new MainResponse(HttpStatus.OK.value(), "SuccessResponse",
                seed);
    }


    public MainResponse setRunning(String nodeName, OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.lndNodeInfo(token, nodeName, "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, "Cannot handle this request");

        JSONObject jsonData = new JSONObject(response.getObject());
        String status = (String) jsonData.get("status");

        if (!status.equals(LndCreationStatusLog.CREATION_STATUS.IS_WAITING_USER_CONFIRMATION.name())) {
            //This call is only allowed to be made when node status is : IS_WAITING_USER_CONFIRMATION
            //right now we do not have any other way to ensure this call does not get called several times
            //as it is just an api endpoint.
            return new MainResponse(HttpStatus.BAD_REQUEST.value(), null,
                    "Cannot handle this request");
        }

        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.RUNNING.name());
        nodeStatus.setNode(nodeName);

        kafkaMessageSender.sendNodeStatus(nodeStatus);

        return new MainResponse(HttpStatus.OK.value(), "SuccessResponse",
                "success");
    }


    public MainResponse addLndPlus(AddLndPlusToNodeRequest request,
                                   OAuth2Authentication authentication) throws JSONException {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse response = httpClientToken.lndNodeInfo(token, request.getLndname(),
                "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, "Cannot handle this request");

        JSONObject jsonData = new JSONObject(response.getObject());
        String network = (String) jsonData.get("network");
        String nodeId = (String) jsonData.get("id");

        try {

            k8LNDPlusDeployment.deployLNDPlus(DeployLNDPlus
                    .builder().accessToken(token).network(network)
                    .nodeId(Integer.valueOf(nodeId)).nodeName(request.getLndname()).build());

        } catch (IOException e) {
            return new MainResponse(HttpStatus.INTERNAL_SERVER_ERROR.value(), "ErrorResponse",
                    null, "Error Adding LND PLUS");
        }
        return new MainResponse(200, "SuccessResponse",
                "Lnd plus added");
    }


    private JSONObject createNodeOnAuthServer(CreateLndNodeRequest request, String token)
            throws JSONException, UnsupportedEncodingException {


        //lnd node create api call should check if user can create lnd node
        //we do not need to call a  different api request for this.
        MainResponse lndNodeInfo = httpClientToken.lndNodeCreate(request, token);

        logger.info(" create node on AuthServer lndNodeService/createNodeOnAuthServer: {} ", lndNodeInfo.toString());
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




    private MainResponse handleNodeCreationV2(CreateLndNodeRequest createLndNodeRequest, String token,
                                              JSONObject lndNode) throws Exception {

//        String lndNodeName = (String) lndNode.get("lndNodeName");
//        String userId = (String) lndNode.get("userId");
//
//        String port = lndNode.getString("port");


        NodeStatus deletedNodeStatus = new NodeStatus();
        deletedNodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.DELETED.name());
        deletedNodeStatus.setNode(createLndNodeRequest.getLndname());


        Map<String, Object> subscribeRequest = new HashMap<>();
        subscribeRequest.put("method", createLndNodeRequest.getPaymentMethod());
        subscribeRequest.put("planId", createLndNodeRequest.getPlanId());
        subscribeRequest.put("discountId", createLndNodeRequest.getDiscountId());
        subscribeRequest.put("productId", createLndNodeRequest.getProductId());
        subscribeRequest.put("nodeName", createLndNodeRequest.getLndname());


        String subscribeResponse;

        try {
            subscribeResponse = billingHttpClient.subscribe(token, subscribeRequest);
            logger.info(" Lnd Node Service line 422 payment result from billing : " + subscribeResponse);
        } catch (Exception e) {
            kafkaMessageSender.sendNodeStatus(deletedNodeStatus);
            throw e;
        }


        JSONObject subscribeResponseJson = new JSONObject(subscribeResponse);
        String responseString = subscribeResponseJson.getJSONObject("data").toString();

        String trackingId = subscribeResponseJson.getJSONObject("data")
                .getString("trackingId");


        createLndNodeRequest.setSubTrackingId(trackingId);


        LndCreationStatusLog lndCreationStatusLog = LndCreationStatusLog.builder()
                .nodeName(createLndNodeRequest.getLndname())
                .status(LndCreationStatusLog.CREATION_STATUS.CREATING.name())
                .build();

        lndCreationStatusLogRepository.save(lndCreationStatusLog);

        LNDDeploymentStrategy strategy = lndDeploymentStrategyFactory
                .getStrategy(createLndNodeRequest.getDeploymentType());


        try {
            logger.info("line 447 Deploy and Start lnd Node function: " + createLndNodeRequest);
            DeployNodeResponse res = lndDeploymentService.deployAndStartLndNode( createLndNodeRequest, strategy, token);

            if (res.isSuccess()) {

                lndDeploymentService.completeLNDDeploymentCheck( createLndNodeRequest, res, strategy);

                return new MainResponse(200, "SuccessResponse",
                        responseString);

            }


        } catch (IOException e) {
            logger.info("An error occurred on deploy: {}", e.getMessage());
        }

        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.DELETED.name());
        nodeStatus.setNode(createLndNodeRequest.getLndname());

        kafkaMessageSender.sendNodeStatus(nodeStatus);

        kafkaMessageSender.sendSubscriptionStatus(new SubscriptionAction(createLndNodeRequest.getSubTrackingId(), "FAILED",
                createLndNodeRequest.getLndname(),  "DELETE"));

        throw new BadRequestException(400,
                "An unexpected error occurred when creating your node, please try again later");


    }

    private MainResponse handleNodeCreation(CreateLndNodeRequest createLndNodeRequest, String token,
                                            JSONObject lndNode)
            throws JSONException {


//        String lndNodeName = (String) lndNode.get("lndNodeName");
//        String userId = (String) lndNode.get("userId");
//
//        String port = lndNode.getString("port");

        LndCreationStatusLog lndCreationStatusLog = LndCreationStatusLog.builder()
                .nodeName(createLndNodeRequest.getLndname())
                .status(LndCreationStatusLog.CREATION_STATUS.CREATING.name())
                .build();

        lndCreationStatusLogRepository.save(lndCreationStatusLog);

        //set node owner email
        createLndNodeRequest.setOwnerEmail(lndNode.getString("ownerEmail"));

        LNDDeploymentStrategy strategy = lndDeploymentStrategyFactory
                .getStrategy(createLndNodeRequest.getDeploymentType());


        try {

            DeployNodeResponse res = lndDeploymentService.deployAndStartLndNode(createLndNodeRequest, strategy, token);

            if (res.isSuccess()) {

                lndDeploymentService.completeLNDDeploymentCheck( createLndNodeRequest, res, strategy);

                return new MainResponse(200, "SuccessResponse",
                        "Lnd node creation in progress");

            }


        } catch (IOException e) {
            logger.info("An error occurred on deploy: {}", e.getMessage());
        }

        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.DELETED.name());
        nodeStatus.setNode(createLndNodeRequest.getLndname());

        kafkaMessageSender.sendNodeStatus(nodeStatus);

        kafkaMessageSender.sendSubscriptionStatus(new SubscriptionAction(createLndNodeRequest.getSubTrackingId(), "FAILED",
                createLndNodeRequest.getLndname(), "DELETE"));

        return new MainResponse(400, "FailedResponse",
                "An unexpected error occurred when creating your node, please try again later");


    }


    public MainResponse restoreLndFromSeed(CreateLndNodeRequest request,
                                           OAuth2Authentication authentication) throws JSONException, IOException {

        if (!request.isRestoration())
            throw new BadRequestException(400, "Handles only node restoration");

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);


        if (!request.isExternalNode() && request.getLndname() == null)
            throw new BadRequestException(400, "node id is required for lqwd nodes");


        if (!request.isExternalNode()) {
            request.setSeed(processLqwdNodeSeedFromDB(request));
        } else {
            request.setSeed(processExternalSeedInputFromUser(request));
        }

        JSONObject lndNode = createNodeOnAuthServer(request, token);

        String lndNodeName = request.isExternalNode() ? (String) lndNode.get("lndNodeName")
                : request.getLndname();

        request.setLndname(lndNodeName);

        saveSeedDetails(lndNodeName, request.getSeed());
        LndNodeConfig lndNodeConfig = lndNodeConfigRepository.getLndNodeLastConfig(lndNodeName);
        HashMap<String, String> confParams = new HashMap<>();
        // use properties to restore the map
        Properties props = new Properties();
        props.load(new StringReader(lndNodeConfig.getConfigParam()
                .substring(1, lndNodeConfig.getConfigParam().length() - 1).replace(", ", "\n")));

        for (Map.Entry<Object, Object> e : props.entrySet()) {
            confParams.put((String) e.getKey(), (String) e.getValue());
        }

        return handleNodeCreation(request, token, lndNode);


    }

    private String processExternalSeedInputFromUser(CreateLndNodeRequest request) {

        if (request.getSeed().contains(","))
            return request.getSeed();

        //process numbered seed \\d.\\s*(\\w+) get all words beginning with numbers. e.g 1. big
        List<String> words = new ArrayList<>();
        Matcher matcher = Pattern.compile("\\d.\\s*(\\w+)").matcher(request.getSeed());
        while (matcher.find()) {
            words.add(matcher.group(1));
        }
        return String.join(",", words);

    }

    private String processLqwdNodeSeedFromDB(CreateLndNodeRequest request) {

        Macaroon macaroon = macaroonService.getMacaroon(String.format("/data/v3/%s/geen_seed",
                request.getLndname()), request.getLndname());

        if (macaroon == null)
            throw new BadRequestException(400, "Gen_seed not found for the specified node");

        String seed = new String(macaroon.getSfile());

        if (seed.contains("cipher_seed_mnemonic"))
            seed = convertSeedToCommaSeperatedString(seed);

        return seed;
    }

    private void saveSeedDetails(String nodeName, String seed) {

        cacheStore.insert(nodeName + "-seed", appProperties.getLnd_password_exp_seconds(),
                seed);
    }


    private String convertSeedToCommaSeperatedString(String seed) {

        String[] slice = seed.split("enciphered_seed:");
        slice = slice[0].replaceAll("\\s+", "")
                .replaceAll("\"", "").split("cipher_seed_mnemonic:");

        slice = Arrays.copyOfRange(slice, 1, slice.length);

        return String.join(",", slice);
    }

    public MainResponse restartLndOnlyWithoutNode(RestartLndRequest request, OAuth2Authentication authentication) throws UnsupportedEncodingException {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.authenticate(request.getPassword(), token);

        if (response.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

         response = httpClientToken.lndNodeInfo(token, request.getLndname(), "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, "Cannot handle this request");

        try {

            JSONObject jsonData = new JSONObject(response.getObject());
            Boolean isNonCustodial = jsonData.getBoolean("isNonCustodial");

            if (isNonCustodial) {
                if (request.getPassphrase() == null) {
                    throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),
                            "For non custodial nodes you need to provide passphrase");
                }

                String encryptedPassword = encryptService.encrypt(request.getPassphrase().getBytes(),
                        "AEAD");
                cacheStore.insert(request.getLndname() + "-passphrase", properties.getLnd_password_exp_seconds(),
                        encryptedPassword);

            }

            LndNodeStatus lndNodeStatus = new LndNodeStatus();
            lndNodeStatus.setLndNodeName(request.getLndname());
            lndNodeStatus.setStatus(request.getAction().name());
            lndNodeStatus.setPubkey(jsonData.getString("nodepubkey"));
            lndNodeStatus.setUpdated(new Date());
            lndNodeStatusRepository.save(lndNodeStatus);

            // update status in oauth2.lndnodeinfo to restarting
            HashMap<String, String> parts = new HashMap<>();
            parts.put("token", token);
            parts.put("lndNodeName", request.getLndname());
            parts.put("status", LndCreationStatusLog.CREATION_STATUS.RESTARTING.name());

            httpClientToken.lndNodeUpdate(token, parts,
                    "/lndnode/update", "LndNodeInfo");


        } catch (JSONException e) {
            logger.info("Error on node restart: {}", e.getMessage());
            return new MainResponse(400, null, "An error occurred when this when restarting your node");
        }


        return new MainResponse(200, "SuccessResponse",
                "Lnd node is in a process for restart");
    }
}