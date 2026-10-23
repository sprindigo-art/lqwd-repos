package com.lqwd.service;


import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.Role;
import com.lqwd.model.enums.LNDNodeRole;
import com.lqwd.model.enums.LndNodeActionSet;
import com.lqwd.model.request.ConfirmLndNodeRequest;
import com.lqwd.model.request.RegistrationRequest;
import com.lqwd.model.request.ShareLndReactRequest;
import com.lqwd.model.request.ShareLndRequest;
import com.lqwd.model.response.MainResponse;
import com.lqwd.utils.LndUtil;
import io.fabric8.kubernetes.api.model.authentication.UserInfo;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.util.UUID;


@Service
@RequiredArgsConstructor
public class ShareLndService {

    private static Logger logger = LoggerFactory.getLogger(ShareLndService.class);
    private final AccessTokenServiceHelper accessTokenServiceHelper;

    private final HttpClientToken httpClientToken;

    private final MacaroonService macaroonService;

    private final UserService userService;

    public MainResponse shareLnd(ShareLndReactRequest request, OAuth2Authentication authentication) throws UnsupportedEncodingException {
        logger.info("Error on shareLnd service : {}", request.getLndNodeName());
        //checking user authentication
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        // check lnd node for owning
        MainResponse response = httpClientToken.lndNodeInfo(token, request.getLndNodeName(), "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200) {
            logger.error("Cannot retrieve info for node {}", request.getLndNodeName());
            return new MainResponse(response.getStatus(), null, response.getError());
        }

        JSONObject jsonData = new JSONObject(response.getObject());
        String ownerEmail = jsonData.getString("ownerEmail");
        //
        MainResponse sharedUser = httpClientToken.sharedUserInfoByEmail(token, request.getSharedEmail());
        if (sharedUser.getStatus() != 200) {
            logger.error("User not exist need to create for share", request.getLndNodeName());
            RegistrationRequest registrationRequest = new RegistrationRequest();
            registrationRequest.setEmail(request.getSharedEmail());
            registrationRequest.setUsername(request.getSharedEmail());
            registrationRequest.setF2a(true);
            UUID randomUUID = UUID.randomUUID();
            String randomTemporaryPass =  randomUUID.toString().replaceAll("_", "").substring(1,10);
            registrationRequest.setPassword(randomTemporaryPass);
            sharedUser = userService.saveUser(registrationRequest);
        }
        ShareLndRequest shareLndRequest = new ShareLndRequest(request);
        JSONObject sharedUserJsonData = new JSONObject(sharedUser.getObject());
        //save share lnd
        shareLndRequest.setLndNodeId(jsonData.getInt("id"));
        UUID sharedUserId = UUID.fromString(sharedUserJsonData.getString("id"));

        shareLndRequest.setSharedUserId(sharedUserId.toString());
        shareLndRequest.setUserId(jsonData.getString("userId"));
        MainResponse responseRole = httpClientToken.findRoleByName(token, request.getRole(), "/share/getrole",
                "Role");

        JSONObject roleJsonData = new JSONObject(responseRole.getObject());
        Role role = new Role();
        role.setName(roleJsonData.getString("name"));
        role.setUuid_id(UUID.fromString(roleJsonData.getString("id")));

        shareLndRequest.setRole(role);

        response = httpClientToken.shareLndNode(token, shareLndRequest, "/share/save",
                "SharedLnd");
        if(response.getStatus() != 200){
            logger.error("Cannot save shared user for  node {}", request.getLndNodeName());
            return new MainResponse(response.getStatus(), null, response.getError());
        }
        //create cypher access for share user (decrypt and encrypt with new passphrase)

        String macaroonString = macaroonService.addCipherFiles(request.getLndNodeName(), request.getPassphrase(),
                request.getNewPassphrase(), sharedUserJsonData.getString("email"));


        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, response.getError());


        return new MainResponse(200, "SuccessResponse",
                response.getObject());
    }

    public MainResponse shareLndUpdate(ShareLndReactRequest request, OAuth2Authentication authentication) throws UnsupportedEncodingException {
        logger.info("Error on shareLnd service : {}", request.getLndNodeName());
        //checking user authentication
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        // check lnd node for owning
        MainResponse response = httpClientToken.lndNodeInfo(token, request.getLndNodeName(), "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200) {
            logger.error("Cannot retrieve info for node {}", request.getLndNodeName());
            new MainResponse(response.getStatus(), null, response.getError());
        }

        JSONObject jsonData = new JSONObject(response.getObject());
        String ownerEmail = jsonData.getString("ownerEmail");
        //
        MainResponse sharedUser = httpClientToken.sharedUserInfoByEmail(token, request.getSharedEmail());

        ShareLndRequest shareLndRequest = new ShareLndRequest(request);
        JSONObject sharedUserJsonData = new JSONObject(sharedUser.getObject());
        //save share lnd
        shareLndRequest.setLndNodeId(jsonData.getInt("id"));
        UUID sharedUserId = UUID.fromString(sharedUserJsonData.getString("id"));

        shareLndRequest.setSharedUserId(sharedUserId.toString());
        shareLndRequest.setUserId(jsonData.getString("userId"));
        MainResponse responseRole = httpClientToken.findRoleByName(token, request.getRole(), "/share/getrole",
                "Role");

        JSONObject roleJsonData = new JSONObject(responseRole.getObject());
        Role role = new Role();
        role.setName(roleJsonData.getString("name"));
        role.setUuid_id(UUID.fromString(roleJsonData.getString("id")));

        shareLndRequest.setRole(role);

        response = httpClientToken.shareLndNode(token, shareLndRequest, "/share/update",
                "SharedLnd");


        //create cypher access for share user (decrypt and encrypt with new passphrase)

//        String macaroonString = macaroonService.addCipherFiles(request.getLndNodeName(), request.getPassphrase(),
//                request.getNewPassphrase(), sharedUserJsonData.getString("email"));


        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, response.getError());


        return new MainResponse(200, "SuccessResponse",
                response.getObject());
    }

    public MainResponse shareLndDelete(ShareLndReactRequest request, OAuth2Authentication authentication) throws UnsupportedEncodingException {
        logger.info("Error on shareLnd service : {}", request.getLndNodeName());
        //checking user authentication
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        // check lnd node for owning
        MainResponse response = httpClientToken.lndNodeInfo(token, request.getLndNodeName(), "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() != 200) {
            logger.error("Cannot retrieve info for node {}", request.getLndNodeName());
            new MainResponse(response.getStatus(), null, response.getError());
        }

        JSONObject jsonData = new JSONObject(response.getObject());
        String ownerEmail = jsonData.getString("ownerEmail");
        //
        MainResponse sharedUser = httpClientToken.sharedUserInfoByEmail(token, request.getSharedEmail());

        ShareLndRequest shareLndRequest = new ShareLndRequest(request);
        JSONObject sharedUserJsonData = new JSONObject(sharedUser.getObject());
        //save share lnd
        shareLndRequest.setLndNodeId(jsonData.getInt("id"));
        UUID sharedUserId = UUID.fromString(sharedUserJsonData.getString("id"));

        shareLndRequest.setSharedUserId(sharedUserId.toString());
        shareLndRequest.setUserId(jsonData.getString("userId"));
        MainResponse responseRole = httpClientToken.findRoleByName(token, request.getRole(), "/share/getrole",
                "Role");

        JSONObject roleJsonData = new JSONObject(responseRole.getObject());
        Role role = new Role();
        role.setName(roleJsonData.getString("name"));
        role.setUuid_id(UUID.fromString(roleJsonData.getString("id")));

        shareLndRequest.setRole(role);

        response = httpClientToken.shareLndNode(token, shareLndRequest, "/share/delete",
                "SharedLnd");


        //create cypher access for share user (decrypt and encrypt with new passphrase)

//        String macaroonString = macaroonService.addCipherFiles(request.getLndNodeName(), request.getPassphrase(),
//                request.getNewPassphrase(), sharedUserJsonData.getString("email"));


        if (response.getStatus() != 200)
            return new MainResponse(response.getStatus(), null, response.getError());


        return new MainResponse(200, "SuccessResponse",
                response.getObject());
    }

    public String getActionAccessLevel(String action){
        if(LndNodeActionSet.supervisorActionSet.contains(action)){
            return LNDNodeRole.SUPERVISOR.toString();
        } else if(LndNodeActionSet.auditActionSet.contains(action)){
            return LNDNodeRole.AUDITOR.toString();
        } else
            return null;
    }

    public boolean checkActionLevel(OAuth2Authentication authentication, String lndnodename, String action) {

        //checking user authentication
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        // check lnd node for owning
        MainResponse response = httpClientToken.lndNodeInfo(token, lndnodename, "/share/getaccesslevel",
                "String");

        if (response.getStatus() != 200) {
            logger.error("You don't have access or role for  node {}", lndnodename);
            new MainResponse(response.getStatus(), null, response.getError());
        }
        if(response.getObject() == null){
            return false;
        }

        String roleName = response.getObject();
        if(roleName.equals(LNDNodeRole.OWNER.toString())) {
            return true;
        }
        if(roleName.equals(LNDNodeRole.ADMIN.toString())){
            return true;
        }
        if(roleName.equals(LNDNodeRole.SUPERVISOR.toString())){
            if(LndNodeActionSet.supervisorActionSet.contains(action)){
                return  true;
            } else {
                return false;
            }
        }
        if(roleName.equals(LNDNodeRole.AUDITOR.toString())){
            if(LndNodeActionSet.auditActionSet.contains(action)){
                return  true;
            } else {
                return false;
            }
        }
        return false;
    }
}
