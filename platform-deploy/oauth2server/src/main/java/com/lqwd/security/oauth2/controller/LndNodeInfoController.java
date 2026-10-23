package com.lqwd.security.oauth2.controller;

import com.lqwd.security.oauth2.model.LndPort;
import com.lqwd.security.oauth2.model.enums.DeploymentType;
import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import com.lqwd.security.oauth2.model.enums.MainStatusNames;
import com.lqwd.security.oauth2.model.request.CreateNodeRequest;
import com.lqwd.security.oauth2.model.request.SharedLndRequest;
import com.lqwd.security.oauth2.model.request.UpdateNodeInfoRequest;
import com.lqwd.security.oauth2.model.response.ErrorResponse;
import com.lqwd.security.oauth2.model.response.LndNodeResponse;
import com.lqwd.security.oauth2.model.response.UserIdResponse;
import com.lqwd.security.oauth2.model.security.*;
import com.lqwd.security.oauth2.service.*;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;

@RestController
@RequestMapping("/lndnode")
@RequiredArgsConstructor
public class LndNodeInfoController {

    private final UserService userService;
    private final LndNodeInfoService lndNodeInfoService;
    private final OauthClientDetailsService oauthClientDetailsService;

    private final LNDPortService lndPortService;
    private final RoleService roleService;
    private final SharedLndsService sharedLndsService;

    @Value("${app.lnd_domain}")
    private String lndDomain;

    @Value("${app.lnd_external_id}")
    private String lndExternalIp;


    private Logger logger = LoggerFactory.getLogger(LndNodeInfoController.class);


    @PostMapping(value = "/getinfo")
    public ResponseEntity<?> getInfo(@RequestParam String lndNodeName,
                                     OAuth2Authentication authentication) {

        User_ user = null;
        logger.info("Lnd Node Info Controller line 62 : " + authentication.isClientOnly() + " " + lndNodeName);
        if (authentication.isClientOnly()) {
            OauthClientDetails clientDetails = oauthClientDetailsService
                    .findOauthClient((String) authentication.getPrincipal());
            logger.info("Lnd Node Info Controller line 66 : " + clientDetails.getClientId().toString());
            if (clientDetails == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"client is null\"}");
        } else {
            user = userService.checkUserByTokenId(authentication);

            if (user == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"User is null\"}");
        }

        logger.info("Lnd Node Info Controller line 76 : ");
        if (user == null && !authentication.isClientOnly())
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        LndNodeInfo lndNodeInfo;
        logger.info("Lnd Node Info Controller line 82 : " + lndNodeName);
        if (authentication.isClientOnly()) {
            lndNodeInfo = lndNodeInfoService.findByLndNodeName(lndNodeName);
        } else {
            lndNodeInfo = lndNodeInfoService.findByLndnodenameAndUser(lndNodeName, user);
            if(lndNodeInfo == null){
                //checking if it is shared user
               lndNodeInfo = sharedLndsService.getSharedLndNodeInfoByUserLndNodeName(user, lndNodeName);

            }
        }
        logger.info("Lnd Node Info Controller line 93 : " + lndNodeName) ;
        if (lndNodeInfo == null)
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Ops! we couldn't identify the node specified \"}");

        if (!authentication.isClientOnly()) {
            lndNodeInfo.setLndNodeRole(sharedLndsService.getLndNodeRole(lndNodeInfo, user));
            logger.info("Lnd Node Info Controller line 99 : " + lndNodeName);
        }
        return ResponseEntity.ok(new LndNodeResponse(lndNodeInfo));
    }

    @GetMapping(value = "/userinfo")
    public ResponseEntity<?> getUserInfo(@RequestParam String lndNodeName) {

        LndNodeInfo lndNodeInfo = lndNodeInfoService.findByLndNodeName(lndNodeName);

        if (lndNodeInfo == null)
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("could not find node with that name").build());

        User_ user = lndNodeInfo.getUser();

        if (user == null)
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("could not find user with that info").build());

        UserIdResponse userResponse = UserIdResponse.builder().id(user.getId().toString()).build();
        return ResponseEntity.ok(userResponse);


    }


    @PostMapping(value = "/getlist")
    public ResponseEntity<?> getLndNodeInfoList(@RequestParam String token, OAuth2Authentication authentication) {


        User_ user = userService.checkUserByTokenId(authentication);

        if (user == null)
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        Collection<LndNodeInfo> lndNodeInfos = user.getLndNodeInfos();

        ArrayList<LndNodeResponse> lndNodeResponsesArrayList = new ArrayList<>();
        Iterator iterator = lndNodeInfos.iterator();
        while (iterator.hasNext()) {
            LndNodeInfo lndNodeInfo = (LndNodeInfo) iterator.next();
            if (!lndNodeInfo.getStatus().equals(LNDNodeStatus.DELETED)) {
                LndNodeResponse lndNodeResponse = new LndNodeResponse(lndNodeInfo);
                lndNodeInfo.setLndNodeRole(sharedLndsService.getLndNodeRole(lndNodeInfo, user));
                lndNodeResponsesArrayList.add(lndNodeResponse);
            }

        }

        return ResponseEntity.ok(lndNodeResponsesArrayList);

    }

    @PostMapping(value = "/updatenodeport")
    public ResponseEntity<?> updateNodePort(@RequestBody CreateNodeRequest createNodeRequest,
                                            OAuth2Authentication authentication) {

        User_ user = userService.checkUserByTokenId(authentication);

        if (user == null)
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("Token expired or wrong").build());
        logger.info("lndNodeInfoId : " + createNodeRequest.getNodeId());
        LndNodeInfo lndNodeInfo = lndNodeInfoService.findById(Long.parseLong(createNodeRequest.getNodeId()));


        int port = 9735;

        if (lndNodeInfo.getDeploymentType().equals(DeploymentType.K8)) {

            LndPort lndPort = lndPortService.GetAvailablePort().orElse(null);

            if (lndPort == null) {
                return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                        .message("Request failed as no ports are available, please contact admin").build());
            }

            port = lndPort.getPort();
            lndPort.setInUse(true);
            lndPortService.save(lndPort);
        }

        logger.info("By request Node port updated for {} where a old port is {} and a new port is {}", lndNodeInfo.getLndnodename(), lndNodeInfo.getPort(), port);

        lndNodeInfo.setPort(Integer.toString(port));

        lndNodeInfo = lndNodeInfoService.save(lndNodeInfo);

        return ResponseEntity.ok(new LndNodeResponse(lndNodeInfo));

    }

    @PostMapping(value = "/create")
    public ResponseEntity<?> createInfo(@RequestBody CreateNodeRequest request,
                                        OAuth2Authentication authentication) {

        User_ user = userService.checkUserByTokenId(authentication);

        if (user == null)
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("Token expired or wrong").build());

        //check if user has an lndnode that is still in creation status
        int totalInCreation = lndNodeInfoService.countLndNodeInCreation(user.getId());

        if (totalInCreation > 0) {
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("You still have a node that is still being created. Please wait a bit").build());
        }

        int noOfLndNotPaid = lndNodeInfoService.countLndNodeNotPaid(user.getId());

        if (noOfLndNotPaid > 0) {
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("You are yet to pay for one or more of your nodes, you have to pay to create new nodes").build());
        }


        LndNodeInfo lndNodeInfo = new LndNodeInfo();

        //check if user can create more lnd nodes
        //lists only nodes that have status not deleted.
        long totalLnds = user.getLndNodeInfos().stream().filter((item) -> !item.getStatus()
                .equals(LNDNodeStatus.DELETED)).count();

        if (totalLnds >= user.getAllowedNoOfLnd())
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("You have exceeded the max allowed no of nodes you can create").build());

        int port = 9735;

        if (request.getDeploymentType().equals(DeploymentType.K8)) {

            LndPort lndPort = lndPortService.GetAvailablePort().orElse(null);

            if (lndPort == null) {
                return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                        .message("Request failed as no ports are available, please contact admin").build());
            }

            port = lndPort.getPort();
            lndPort.setInUse(true);
            lndPortService.save(lndPort);
        }

        lndNodeInfo.setExternalip(request.getExternalIp());
        lndNodeInfo.setLndnodename(request.getLndNodeName());
        lndNodeInfo.setDomain(lndDomain);
        lndNodeInfo.setKeySendEnabled(request.isKeySendEnabled());
        lndNodeInfo.setUser(user);
        lndNodeInfo.setIsRoutingNode(request.isRoutingNode());
        lndNodeInfo.setIsNonCustodial(request.isNonCustodial());
        lndNodeInfo.setDeploymentType(request.getDeploymentType());
        lndNodeInfo.setConfirmed(request.isConfirmed());
        lndNodeInfo.setNetwork(request.getNetwork());
        lndNodeInfo.setStatus(request.getStatus());
        lndNodeInfo.setDescription("Personal node");
        lndNodeInfo.setWatchtower(request.getWatchtower());
        lndNodeInfo.setNodeAlias(request.getAlias());
        lndNodeInfo.setNamespace(request.getNamespace());


        lndNodeInfo = lndNodeInfoService.save(lndNodeInfo);
        String nodeName = request.getLndNodeName() + "-" + lndNodeInfo.getId();
        lndNodeInfo.setLndnodename(nodeName);
        lndNodeInfo.setPort(Integer.toString(port));

        if (request.getDeploymentType().equals(DeploymentType.K8)) {
            lndNodeInfo.setPrivateAddress(String.format("%s.%s", nodeName, request.getNamespace()));
        }

        lndNodeInfo = lndNodeInfoService.save(lndNodeInfo);

        return ResponseEntity.ok(new LndNodeResponse(lndNodeInfo));

    }


    @PostMapping(value = "/update")
    public ResponseEntity<?> updateInfo(
            @RequestBody UpdateNodeInfoRequest request,
            OAuth2Authentication authentication) {


        ResponseEntity<String> validationError = validateUserAndClient(authentication);

        if (validationError != null)
            return validationError;


        LndNodeInfo lndNodeInfo = lndNodeInfoService.findByLndNodeName(request.getLndNodeName());

        if (lndNodeInfo == null)
            return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"node not found\"}");

        if (request.getInstanceId() != null)
            lndNodeInfo.setInstanceId(request.getInstanceId());
        if (request.getStatus() != null)
            lndNodeInfo.setStatus(request.getStatus());
        if (request.getPrivateAddress() != null)
            lndNodeInfo.setPrivateAddress(request.getPrivateAddress());
        if (request.getPublicAddress() != null)
            lndNodeInfo.setPublicAddress(request.getPublicAddress());
        if (request.getPubKey() != null)
            lndNodeInfo.setNodepubkey(request.getPubKey());

        lndNodeInfo.setNamespace("lqwd-lnd");
        lndNodeInfo = lndNodeInfoService.save(lndNodeInfo);


        return ResponseEntity.ok(new LndNodeResponse(lndNodeInfo));
    }


    @PostMapping(value = "/confirm")
    public ResponseEntity<?> confirmNode(
            @RequestParam String lndNodeName,
            OAuth2Authentication authentication) {

        ResponseEntity<String> validationError = validateUserAndClient(authentication);

        if (validationError != null)
            return validationError;

        LndNodeInfo lndNodeInfo;
        if (authentication.isClientOnly()) {
            lndNodeInfo = lndNodeInfoService.findByLndNodeName(lndNodeName);
        } else {
            User_ user = userService.checkUserByTokenId(authentication);
            lndNodeInfo = lndNodeInfoService.findByLndnodenameAndUser(lndNodeName, user);
        }

        if (lndNodeInfo == null)
            return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"node not found\"}");

        if (!lndNodeInfo.getIsNonCustodial())
            return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"Operation cannot be carried on custodial node\"}");

        lndNodeInfo.setConfirmed(true);
        lndNodeInfo = lndNodeInfoService.save(lndNodeInfo);

        return ResponseEntity.ok(new LndNodeResponse(lndNodeInfo));
    }


    @PostMapping(value = "/setlitnode")
    public ResponseEntity<?> setLitNode(
            @RequestParam String lndNodeName,
            @RequestParam String litNodeName,
            OAuth2Authentication authentication) {


        ResponseEntity<String> validationError = validateUserAndClient(authentication);

        if (validationError != null)
            return validationError;


        LndNodeInfo lndNodeInfo = lndNodeInfoService.findByLndNodeName(lndNodeName);

        if (lndNodeInfo == null)
            return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"node not found\"}");

        lndNodeInfo.setLitNodeName(litNodeName);
        lndNodeInfo = lndNodeInfoService.save(lndNodeInfo);


        return ResponseEntity.ok(new LndNodeResponse(lndNodeInfo));


    }

    @PostMapping(value = "/delete")
    public ResponseEntity<?> deleteInfo(@RequestParam String lndNodeName,
                                        OAuth2Authentication authentication) {

        ResponseEntity<String> validationError = validateUserAndClient(authentication);

        if (validationError != null)
            return validationError;


        LndNodeInfo lndNodeInfo = lndNodeInfoService.findByLndNodeName(lndNodeName);

        if (lndNodeInfo == null)
            return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"Lnd node info not found\"}");

        lndNodeInfo.setStatus(LNDNodeStatus.DELETED);
        lndNodeInfoService.save(lndNodeInfo);

        lndPortService.releaseLndPort(Integer.parseInt(lndNodeInfo.getPort()));

        sharedLndsService.deleteSharedLndByLndName(lndNodeInfo.getId());

        return ResponseEntity.ok("deleted");

    }

    private ResponseEntity<String> validateUserAndClient(OAuth2Authentication authentication) {
        if (authentication.isClientOnly()) {
            OauthClientDetails clientDetails = oauthClientDetailsService.findOauthClient((String) authentication.getPrincipal());
            if (clientDetails == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"client is null\"}");
        } else {
            User_ user = userService.checkUserByTokenId(authentication);
            if (user == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"User is null\"}");
        }
        return null;
    }

}
