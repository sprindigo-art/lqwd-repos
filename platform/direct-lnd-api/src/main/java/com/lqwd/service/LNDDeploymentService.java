package com.lqwd.service;

import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.exceptions.ServerErrorException;
import com.lqwd.factories.LNDDeploymentStrategyFactory;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.interfaces.CacheStore;
import com.lqwd.interfaces.LNDDeploymentStrategy;
import com.lqwd.messaging.schemas.DestroyNode;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.NodeStatus;
import com.lqwd.messaging.schemas.PushData;
import com.lqwd.messaging.schemas.PushNotification;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.messaging.schemas.SubscriptionAction;
import com.lqwd.model.DeployNodeRequest;
import com.lqwd.model.DeployNodeResponse;
import com.lqwd.model.DestroyNodeRequest;
import com.lqwd.model.DestroyNodeResponse;
import com.lqwd.model.entities.LndCreationStatusLog;
import com.lqwd.model.entities.Macaroon;
import com.lqwd.model.enums.DeploymentType;
import com.lqwd.model.request.CreateLndNodeRequest;
import com.lqwd.model.request.DestroyLndNodeRequest;
import com.lqwd.model.request.RestartLndNodeRequest;
import com.lqwd.model.request.UnlockLndNodeRequest;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.repository.LndNodeBalanceRepository;
import com.lqwd.repository.LndNodeInfoRepository;
import lombok.RequiredArgsConstructor;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.AsyncResult;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

@RefreshScope
@Service
@RequiredArgsConstructor
public class LNDDeploymentService {

    private static final Logger logger = LoggerFactory.getLogger(LNDDeploymentService.class);

    private final AccessTokenServiceHelper accessTokenServiceHelper;

    private final HttpClientToken httpClientToken;

    private final LndHttpClient lndHttpClient;

    private final MacaroonService macaroonService;


    private final CacheStore cacheStore;

    private final EncryptService encryptService;

    private final LndChannelService lndChannelService;


    private final AppProperties properties;
    private final LNDDeploymentStrategyFactory lndDeploymentStrategyFactory;
    private final KafkaMessageSender kafkaMessageSender;

    private final LndNodeBalanceRepository lndNodeBalanceRepository;
    private final LndNodeInfoRepository lndNodeInfoRepository;


    @Transactional
    public void destroyLND(DestroyNode destroyNode) {

        String token = accessTokenServiceHelper.getClientAccessToken();

        MainResponse response = httpClientToken
                .lndNodeInfo(token, destroyNode.getNodeId().toString(),
                        "/lndnode/getinfo", "LndNodeInfo");

        if (response.getStatus() != 200) {
            throw new ServerErrorException(HttpStatus.BAD_REQUEST.value(), response.getError());
        }

        //delete node oauth2
        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.DELETED.name());
        nodeStatus.setNode(destroyNode.getNodeId());

        kafkaMessageSender.sendNodeStatus(nodeStatus);


        JSONObject jsonData = new JSONObject(response.getObject());

        DeploymentType deploymentType = DeploymentType
                .valueOf(jsonData.getString("deploymentType"));

        LNDDeploymentStrategy strategy = lndDeploymentStrategyFactory
                .getStrategy(deploymentType);

        String privateAddress = strategy.getAddress(jsonData);


        if (!destroyNode.getForce()) {

            try {

                if (!isSafeToDestroyNode(destroyNode.getNodeId().toString(),
                        jsonData, privateAddress)) {
                    //notify admin
                    String message = String.format("LND %s with owner %s could not be destroyed because the node has funds on it." +
                                    " However a soft delete was performed and the user no longer has access to the node<br>" +
                                    " <b>Reason:</b> Default on subscription", destroyNode.getNodeId().toString(),
                            jsonData.get("ownerEmail"));

                    sendDestroyNodeRestrictedEmail(message, "Node Deletion Failure");
                    return;
                }

            } catch (Exception e) {
                //notify admin
                String message = String.format("LND %s with owner %s could not be destroyed because an exception occurred" +
                                " when checking for funds<br> However a soft delete was performed and the user no longer " +
                                "has access to the node<br>" +
                                " <b>Reason:</b> %s", destroyNode.getNodeId().toString(),
                        jsonData.get("ownerEmail"), e.getMessage());

                sendDestroyNodeRestrictedEmail(message, "Node Deletion Failure");

                return;
            }
        }

        Object instanceId = jsonData.get("instanceId");

        strategy.destroy(DestroyNodeRequest.builder().nodeName(destroyNode.getNodeId().toString())
                .instanceId(instanceId != null ? instanceId.toString() : null)
                .password(destroyNode.getPassword() != null ?
                        destroyNode.getPassword().toString() : null ).build());


        lndNodeBalanceRepository.deleteAllByNodeName(destroyNode.getNodeId().toString());
        lndNodeInfoRepository.deleteByNodeName(destroyNode.getNodeId().toString());

    }

    @Transactional
    public ResponseEntity<?> destroyNode(DestroyLndNodeRequest request,
                                         OAuth2Authentication authentication) throws UnsupportedEncodingException {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.authenticate(request.getPassword(), token);

        if (response.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

        response = httpClientToken.lndNodeInfo(token,
                request.getLndname(), "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200)
            throw new ServerErrorException(HttpStatus.BAD_REQUEST.value(), response.getError());
        logger.info("Lnd Deployment service line 183 : " + response.toString());
        if(!response.getObject().toString().equals("Name or service not known")) {
            logger.info("Lnd Deployment Service line 185 : ");
                    JSONObject jsonData = new JSONObject(response.getObject());
            logger.info("Lnd Deployment Service line 187 : ");
            Boolean isNonCustodial = jsonData.getBoolean("isNonCustodial");
            logger.info("Lnd Deployment Service line 189 : ");
            if (isNonCustodial && StringUtils.isEmpty(request.getPassphrase()))
                throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),
                        "For non custodial nodes you need to provide passphrase");

            logger.info("Lnd Deployment Service line 194 : ");
            DeploymentType deploymentType = DeploymentType
                    .valueOf(jsonData.getString("deploymentType"));
            logger.info("Lnd Deployment Service line 197 : ");
            LNDDeploymentStrategy strategy = lndDeploymentStrategyFactory
                    .getStrategy(deploymentType);

            String privateAddress = strategy.getAddress(jsonData);
            logger.info("Lnd Deployment Service line 202 : " + request.isForce());
            if (!request.isForce()) {
                handleDestroyValidation(request.getLndname(), jsonData, privateAddress);
            }
            logger.info("Lnd DEployment service line 206  before channels check: " + request.getLndname().toString());
            try {
                logger.info("Lnd DEployment service line 208  after close channels : " );
                lndChannelService.closeAllLndChannels(request.getLndname(), privateAddress
                        , request.getPassphrase());
                logger.info("Lnd DEployment service line 211  after close channels : ");
            } catch (Exception e){
                logger.info("Lnd DEployment service line 213  after close channels : ");
                logger.info(" Active channels close not possible " + e.getMessage());
            }
            Object instanceId = jsonData.get("instanceId");

            strategy.destroy(DestroyNodeRequest.builder().nodeName(request.getLndname())
                    .instanceId(instanceId != null ? instanceId.toString() : null)
                    .password(request.getPassphrase()).build());
        }

        //delete node oauth2
        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.DELETED.name());
        nodeStatus.setNode(request.getLndname());

        kafkaMessageSender.sendNodeStatus(nodeStatus);

        //clear node data
        lndNodeBalanceRepository.deleteAllByNodeName(request.getLndname());
        lndNodeInfoRepository.deleteByNodeName(request.getLndname());

        kafkaMessageSender.sendSubscriptionStatus(new SubscriptionAction("NONE", "DELETE",
                request.getLndname(), "DELETE"));

        return ResponseEntity.ok(new MainResponse(200, "SuccessResponse",
                "Lnd node deleted successfully"));

    }

    private boolean isSafeToDestroyNode(String nodeName, JSONObject data, String nodeAddress) throws Exception {


        String network = data.getString("network");

        if (!network.equalsIgnoreCase("mainnet"))
            return true;


        if (checkActiveChannelsExist(nodeName, nodeAddress)) {
            return false;
        }

        if (checkHasMoney(nodeName, nodeAddress)) {
            return false;
        }


        return true;

    }

    private void handleDestroyValidation(String nodeName, JSONObject data, String nodeAddress) {


        String network = data.getString("network");

        if (!network.equalsIgnoreCase("mainnet"))
            return;

        boolean hasActiveChannels = false;
        boolean hasMoney = false;

        try {

            hasActiveChannels = checkActiveChannelsExist(nodeName,
                    nodeAddress);

            hasMoney = checkHasMoney(nodeName, nodeAddress);

        } catch (Exception e) {

            if(e.getCause().toString().contains("service not known")){
                logger.info(" Lnd Deployment service  line 285:" + e.getCause().toString());
                return;
            } else {
                handleExceptionOnNodeDestroy(nodeName);
            }
        }

        if (hasActiveChannels)
            throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                    "Cannot destroy node. It has active channels");


        if (hasMoney)
            throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                    "Cannot destroy node. It has some money in it's wallet");

    }

    private void handleExceptionOnNodeDestroy(String lndNodeName) {

        //delete node oauth2
        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setStatus("ON_HOLD");
        nodeStatus.setNode(lndNodeName);

        kafkaMessageSender.sendNodeStatus(nodeStatus);

        String message = String.format("There was an error deleting the following node<br />%s", lndNodeName);
        sendDestroyNodeRestrictedEmail(message, "Node Deletion Failure");

        throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                "Cannot destroy node. There was an error communicating with your node");
    }


    public boolean checkLndRunning(String lndNodeName, String nodeAddress, String password) {

        boolean isRunning = false;

        try {
            LNDResponse lndContent = lndHttpClient.getRequestToLndPod("v1/getinfo",
                    nodeAddress, Optional.empty(), lndNodeName,
                    password);

            logger.info("lnd content" + lndContent);

            if (lndContent.getStatus() == 200)
                isRunning = true;

        } catch (Exception e) {
            logger.info("An error occurred when checking lnd health: {}", e.getMessage());
        }

        if (isRunning) {
            Macaroon macaroon = macaroonService.getMacaroon("admin.macaroon", lndNodeName);

            if (macaroon == null)
                isRunning = false;

        }

        return isRunning;
    }


    @Async
    public void deleteAndRestartNode(String token, RestartLndNodeRequest request,
                                     String port, String userId, CreateLndNodeRequest createLndNodeRequest) {
        //update node status
        HashMap<String, String> parts = new HashMap<>();
        parts.put("token", token);
        parts.put("lndNodeName", request.getLndname());
        parts.put("status", LndCreationStatusLog.CREATION_STATUS.RESTARTING.name());

        httpClientToken.lndNodeUpdate(token, parts,
                "/lndnode/update", "LndNodeInfo");

        LNDDeploymentStrategy strategy = lndDeploymentStrategyFactory.getStrategy(request.getDeploymentType());
        // destroy deployment
        DestroyNodeResponse response = strategy
                .destroy(DestroyNodeRequest.builder()
                        .nodeName(request.getLndname()).instanceId(request.getInstanceId())
                        .password(request.getPassphrase()).build());

        if (response.isSuccess()) {

            //wait a while for deployment delete process to take place on k8s
            try {
                TimeUnit.SECONDS.sleep(60);
            } catch (InterruptedException e) {
                logger.info("An error occurred on sleep: {}", e.getMessage());
            }

            //then deploy again
            try {
                deployAndStartLndNode(createLndNodeRequest, strategy, token);
            } catch (IOException e) {
                logger.info("An error occurred on deploy: {}", e.getMessage());
            }
        }

    }

    @Async
    public void checkWalletIsUnlocked(UnlockLndNodeRequest request, String token) {
        boolean unLocked = false;
        int count = 1;

        while (unLocked == false && count < 10) {

            try {
                TimeUnit.SECONDS.sleep(60);
                logger.info("Checking if node: {} is unlocked", request.getLndname());
                unLocked = checkWalletUnlocked(request.getLndname(), request.getPrivateAddress(),
                        request.getPassphrase());
            } catch (Exception e) {
                logger.error("An error occurred when making request to lnd: {}", e.getMessage());
            }
        }

        if (unLocked) {
            //wallet is unlocked so we can set lnd to running now.

            NodeStatus nodeStatus = new NodeStatus();
            nodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.RUNNING.name());
            nodeStatus.setNode(request.getLndname());

            kafkaMessageSender.sendNodeStatus(nodeStatus);


        } else {
            //TODO
            //do nothing. leave state as unlocked. so user can try again.
            //or maybe send user another email
        }

    }


    private boolean checkWalletUnlocked(String nodeName, String nodeAddress, String password) throws Exception {

        LNDResponse lndContent = lndHttpClient.getRequestToLndPod("v1/state", nodeAddress,
                Optional.of(new HashMap<>()),
                nodeName, password);

        if (lndContent.getStatus() != 200)
            return false;

        JSONObject jsonData = new JSONObject(lndContent.getResponse());
        String state = (String) jsonData.get("state");

        //if state is not in any of the states below, lnd has not yet gotten to the point were it has been unlocked
        return !state.equals("LOCKED") && !state.equals("NON_EXISTING") && !state.equals("WAITING_TO_START");

    }


    public DeployNodeResponse deployAndStartLndNode(CreateLndNodeRequest createLndNodeRequest,
                                                    LNDDeploymentStrategy strategy, String token) throws IOException {

        insertPasswordAndPhraseInCache(createLndNodeRequest.getLndname(), createLndNodeRequest);

        DeployNodeRequest deployNodeRequest = DeployNodeRequest.builder()
                .nodeId(createLndNodeRequest.getNodeId())
                .port(createLndNodeRequest.getNodePort())
                .nodeName(createLndNodeRequest.getLndname())
                .restoreNodeName(createLndNodeRequest.getLndname())
                .watchTower(createLndNodeRequest.isWatchTower())
                .lndNetwork(createLndNodeRequest.getLndNetwork())
                .alias(createLndNodeRequest.getAlias())
                .nonCustodial(createLndNodeRequest.getIsNonCustodial())
                .ownersEmail(createLndNodeRequest.getOwnerEmail())
                .keySendEnabled(createLndNodeRequest.isKeySendEnabled())
                .userId(createLndNodeRequest.getUserId())
                .routingNode(createLndNodeRequest.isRoutingNode())
                .torEnable(createLndNodeRequest.isTorEnable())
                .restoration(createLndNodeRequest.isRestoration())
                .build();


        return strategy.deploy(deployNodeRequest, createLndNodeRequest, token);


    }

    @Async
    public Future<Boolean> completeLNDDeploymentCheck( CreateLndNodeRequest createLndNodeRequest,
                                                      DeployNodeResponse response,
                                                      LNDDeploymentStrategy strategy) {

        boolean isRunning = tryPingLNDNode( createLndNodeRequest, response);

        if (isRunning == false) {

            strategy.destroy(DestroyNodeRequest.builder().instanceId(response.getInstanceId())
                    .nodeName(createLndNodeRequest.getLndname())
                    .password(createLndNodeRequest.getPassphrase()).build());

            kafkaMessageSender.sendSubscriptionStatus(new SubscriptionAction(createLndNodeRequest.getSubTrackingId(), "FAILED",
                    createLndNodeRequest.getLndname(), "DELETE"));

            return deleteNodeOnFailure(createLndNodeRequest.getLndname());
        }


        logger.info("Deploy response is : {}", response);

        String nodeStatus = createLndNodeRequest.getIsNonCustodial() ? LndCreationStatusLog.CREATION_STATUS
                .IS_WAITING_USER_CONFIRMATION.name() : LndCreationStatusLog.CREATION_STATUS
                .RUNNING.name();

        sendNodeStatus(createLndNodeRequest.getLndname(), nodeStatus, response);

        kafkaMessageSender.sendSubscriptionStatus(new SubscriptionAction(createLndNodeRequest.getSubTrackingId(), nodeStatus,
                createLndNodeRequest.getLndname(), "CONFIRM"));


        sendPush(createLndNodeRequest.getUserId());


        return new AsyncResult<>(true);
    }

    private void sendNodeStatus(String lndNodeName, String status, DeployNodeResponse response) {

        Macaroon macaroon = macaroonService.getMacaroon("admin.macaroon", lndNodeName);
        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setPrivateAddress(response.getPrivateAddress());
        nodeStatus.setPublicAddress(response.getPublicAddress());
        nodeStatus.setInstanceId(response.getInstanceId());
        nodeStatus.setStatus(status);
        nodeStatus.setNode(lndNodeName);
        nodeStatus.setPubKey(macaroon == null ? null : macaroon.getPubkey());

        kafkaMessageSender.sendNodeStatus(nodeStatus);
    }

    private AsyncResult<Boolean> deleteNodeOnFailure(String lndNodeName) {

        NodeStatus nodeStatus = new NodeStatus();
        nodeStatus.setStatus(LndCreationStatusLog.CREATION_STATUS.DELETED.name());
        nodeStatus.setNode(lndNodeName);

        kafkaMessageSender.sendNodeStatus(nodeStatus);

        return new AsyncResult<>(false);
    }

    private void sendPush(String userId) {
        PushNotification notification = new PushNotification();
        notification.setUserId(userId);
        PushData data = new PushData();
        data.setMessageType("EVENT");
        data.setEventType("NODE_STATUS");
        data.setTimestamp(System.currentTimeMillis());
        data.setData("");

        notification.setData(data);

        kafkaMessageSender.sendPush(notification);
    }


    private boolean tryPingLNDNode( CreateLndNodeRequest createLndNodeRequest, DeployNodeResponse response) {
        boolean isRunning = false;
        int count = 1;

        while (isRunning == false && count < 10) {

            String passphrase = createLndNodeRequest.getIsNonCustodial() ? createLndNodeRequest.getPassphrase() : null;

            isRunning = checkLndRunning(createLndNodeRequest.getLndname(), response.getPrivateAddress(), passphrase);

            if (!isRunning) {
                count++;
                try {
                    TimeUnit.SECONDS.sleep(60);
                } catch (InterruptedException e) {
                    logger.info("Error on time sleep: {}", e.getMessage());
                }
            }

        }

        return isRunning;
    }

    public void insertPasswordAndPhraseInCache(String lndNodeName, CreateLndNodeRequest request) {

        if (request.getIsNonCustodial() == true) {

            if (!StringUtils.isEmpty(request.getPassphrase())) {
                String encryptedPassword = encryptService.encrypt(request.getPassphrase().getBytes(),
                        "AEAD");

                cacheStore.insert(lndNodeName + "-passphrase", properties.getLnd_password_exp_seconds(),
                        encryptedPassword);
            }
        }

    }


    public boolean checkActiveChannelsExist(String lndNodeName, String nodeAddress) throws Exception {

        try {
            logger.info("Lnd DEployment service line 585  checking active channels : ");
            LNDResponse response = lndHttpClient.getRequestToLndPod("v1/channels?active_only=true",
                    nodeAddress, Optional.empty(), lndNodeName, null);
            if (response == null)
                throw new Exception("Cannot connect to node");
            logger.info("Lnd DEployment service line 590 : ");
            if (response.getStatus() != 200)
                throw new Exception("Cannot connect to node");
            logger.info("Lnd DEployment service line 593 ");
            JSONObject responseObj = new JSONObject(response.getResponse());
            logger.info("Lnd DEployment service line 595");
            JSONArray jsonArray = responseObj.getJSONArray("channels");
            logger.info("Lnd DEployment service line 597");
            return jsonArray.length() > 0;
        } catch (Exception e) {
            logger.info(e.getMessage());
            if(e.getMessage().contains("service not known")){
                logger.info("Lnd DEployment service line 210  after close channels : " + e.getMessage());
                return false;
            }
            return false;
        }
    }


    public boolean checkHasMoney(String lndNodeName, String nodeAddress) throws Exception {
        try {
            logger.info("Lnd DEployment service line 612 check amount  : ");
            LNDResponse response = lndHttpClient.getRequestToLndPod("/v1/balance/blockchain",
                    nodeAddress, Optional.empty(), lndNodeName, null);

            if (response == null)
                throw new Exception("Cannot connect to node");
            logger.info("Lnd DEployment service line 618");
            if (response.getStatus() != 200)
                throw new Exception("Cannot connect to node");
            logger.info("Lnd DEployment service line 621 ");
            JSONObject responseObj = new JSONObject(response.getResponse());
            logger.info("Lnd DEployment service line 623");
            String balance = responseObj.getString("total_balance");
            logger.info("Lnd DEployment service line 623");
            return (!balance.equals("0") && Double.valueOf(balance) > 0);
        } catch (Exception e) {
            logger.info(" line 629 " + e.getMessage());
            if (e.getMessage().contains("service not known")) {
                logger.info("Lnd DEployment service line 631   : " + e.getMessage());
                return false;
            }
            return false;
        }
    }

    private void sendDestroyNodeRestrictedEmail(String message, String subject) {

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message);
        emailBody.setSubject(subject);
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        List<EmailAddress> receivers = new ArrayList<>();

        String[] recipients = properties.getLnd_notification_email().split(",");

        for (String email : recipients) {
            EmailAddress receiver = new EmailAddress();
            receiver.setDisplayName(email);
            receiver.setEmail(email);
            receiver.setRecipientType(RecipientType.TO);
            receivers.add(receiver);
        }

        emailBody.setRecipients(receivers);
        emailBody.setSender(sender);
        kafkaMessageSender.sendEmail(emailBody);

    }
}