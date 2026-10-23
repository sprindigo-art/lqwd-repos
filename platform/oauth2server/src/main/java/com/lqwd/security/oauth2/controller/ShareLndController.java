package com.lqwd.security.oauth2.controller;

import com.lqwd.security.oauth2.model.enums.LNDNodeStatus;
import com.lqwd.security.oauth2.model.enums.MainStatusNames;
import com.lqwd.security.oauth2.model.request.SharedLndRequest;
import com.lqwd.security.oauth2.model.response.LndNodeResponse;
import com.lqwd.security.oauth2.model.response.SharedUsersPermission;
import com.lqwd.security.oauth2.model.security.*;

import com.lqwd.security.oauth2.service.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.io.IOException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;

@Controller
@RequestMapping("/share")
@RequiredArgsConstructor
public class ShareLndController {


    public final RoleService roleService;

    public final UserService userService;

    public final OauthClientDetailsService oauthClientDetailsService;

    public final SharedLndsService sharedLndsService;

    public final LndNodeInfoService lndNodeInfoService;

    @PostMapping(value = "/save")
    public ResponseEntity<? extends Object> save(@RequestBody SharedLndRequest sharedLndRequest,
                             OAuth2Authentication authentication) throws IOException {
        User_ user = null;
        if (authentication.isClientOnly()) {
            OauthClientDetails clientDetails = oauthClientDetailsService
                    .findOauthClient((String) authentication.getPrincipal());

            if (clientDetails == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"client is not exist in share lnd save\"}");
        } else {
            user = userService.checkUserByTokenId(authentication);

            if (user == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"User is not exist \"}");
        }


        if (user == null && !authentication.isClientOnly())
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        sharedLndsService.deleteSharedLnd(sharedLndRequest.getNewUser_id(), sharedLndRequest.getLndNode_id());

        ResponseEntity<?> respose = sharedLndSave(sharedLndRequest);

        return respose;

    }

    @PostMapping(value = "/update")
    public ResponseEntity<?> updateSharedLndRole(@RequestBody SharedLndRequest sharedLndRequest, OAuth2Authentication authentication) throws IOException {

        User_ user = null;
        if (authentication.isClientOnly()) {
            OauthClientDetails clientDetails = oauthClientDetailsService
                    .findOauthClient((String) authentication.getPrincipal());

            if (clientDetails == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"client is not exist in share lnd save\"}");
        } else {
            user = userService.checkUserByTokenId(authentication);

            if (user == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"User is not exist \"}");
        }

        if (user == null && !authentication.isClientOnly())
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        sharedLndsService.deleteSharedLnd(sharedLndRequest.getNewUser_id(), sharedLndRequest.getLndNode_id());

        ResponseEntity<?> response = sharedLndSave(sharedLndRequest);


        return response;
    }

    @PostMapping(value = "/delete")
    public ResponseEntity<?> deleteSharedLndRole(@RequestBody SharedLndRequest sharedLndRequest, OAuth2Authentication authentication) throws IOException {

        User_ user = null;
        if (authentication.isClientOnly()) {
            OauthClientDetails clientDetails = oauthClientDetailsService
                    .findOauthClient((String) authentication.getPrincipal());

            if (clientDetails == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"client is not exist in share lnd save\"}");
        } else {
            user = userService.checkUserByTokenId(authentication);

            if (user == null)
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"User is not exist \"}");
        }

        if (user == null && !authentication.isClientOnly())
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        sharedLndsService.deleteSharedLnd(sharedLndRequest.getNewUser_id(), sharedLndRequest.getLndNode_id());

        return ResponseEntity.ok("{\"error\":\"false\", \"message\": \"Role for Lnd node successfully deleted \"}");
    }

    private ResponseEntity<?> sharedLndSave(@RequestBody SharedLndRequest sharedLndRequest) throws IOException {
        SharedLnds sharedLnds = new SharedLnds();
        LndNodeInfo lndNodeInfo = lndNodeInfoService.findById(Long.parseLong(sharedLndRequest.getLndNode_id()));
        if(!lndNodeInfo.getStatus().toString().equals("RUNNING")) {
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Lnd Node not in Running status or not paid\"}");
        }
        if(!lndNodeInfo.getPaid()) {
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Lnd Node not in Running status or not paid\"}");
        }
        sharedLnds.setLndNodeInfo(lndNodeInfo);
        User_ sharedUser = userService.findById(sharedLndRequest.getNewUser_id());
        sharedLnds.setUser(sharedUser);
        sharedLnds.setStatus(MainStatusNames.ACTIVE.toString());
        Role_ role = roleService.findRole(sharedLndRequest.getRole_id());
        sharedLnds.setRole(role);
        Timestamp timestamp = new Timestamp(System.currentTimeMillis());
        sharedLnds.setCreatedDate(timestamp);
        sharedLnds = sharedLndsService.save(sharedLnds);
        return ResponseEntity.ok("{\"error\":\"false\", \"message\": \"Role action for Lnd node successfully updated \"}");
    }

    @PostMapping(value = "/getrole")
    public ResponseEntity<?> getInfoRole(@RequestParam String roleName, OAuth2Authentication authentication) {

        Role_ role;

        role = roleService.findAllByMserviceAndRole("lnd", roleName);

        if (role == null)
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Ops! Role not exist \"}");

        return ResponseEntity.ok(role);
    }

    @PostMapping(value = "/getlist")
    public ResponseEntity<?> getLndNodeInfoList(@RequestParam String token, OAuth2Authentication authentication) {


        User_ user = userService.checkUserByTokenId(authentication);

        if (user == null)
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        ArrayList<LndNodeResponse> lndNodeResponses = sharedLndsService.getSharedLndNodeInfos(user);

        return ResponseEntity.ok(lndNodeResponses);

    }

    @PostMapping(value = "/getsharedusers")
    public ResponseEntity<?> getSharedUsers(@RequestParam String token, OAuth2Authentication authentication) {


        User_ user = userService.checkUserByTokenId(authentication);

        if (user == null)
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        ArrayList<SharedUsersPermission> sharedUsersPermissions = sharedLndsService.getSharedUsersList(user);

        return ResponseEntity.ok(sharedUsersPermissions);

    }

    @PostMapping(value = "/getsharedusers/history")
    public ResponseEntity<?> getSharedUsersHistory(@RequestParam String token, OAuth2Authentication authentication) {


        User_ user = userService.checkUserByTokenId(authentication);

        if (user == null)
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        ArrayList<SharedUsersPermission> sharedUsersPermissions = sharedLndsService.getSharedUsersListHistory(user);

        return ResponseEntity.ok(sharedUsersPermissions);

    }

    @PostMapping(value = "/getaccesslevel")
    public ResponseEntity<?> getAccessLevelRoleName( @RequestParam String token, @RequestParam String lndNodeName, OAuth2Authentication authentication) {


        User_ user = userService.checkUserByTokenId(authentication);

        if (user == null)
            return ResponseEntity.badRequest().body
                    ("{\"error\":\"true\", \"message\": \"Token expired or wrong / error\"}");

        LndNodeInfo lndNodeInfo = lndNodeInfoService.getLndNodeByName(user, lndNodeName);
        if(lndNodeInfo.getId() == null){
            lndNodeInfo = lndNodeInfoService.findByLndNodeName(lndNodeName);
            if(lndNodeInfo != null) {
                SharedLnds sharedLnds = sharedLndsService.getSharedLndNodeInfo(user.getId(), lndNodeInfo.getId());
                if (sharedLnds == null) {
                    return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"Lnd Node not found for this user\"}");
                } else {
                    return ResponseEntity.ok(sharedLnds.getRole().getName());
                }
            } else {
                return ResponseEntity.badRequest().body("{\"error\":\"true\", \"message\": \"Lnd Node not found for this user\"}");
            }
        } else {
            String roleName = sharedLndsService.getLndNodeRole(lndNodeInfo, user);
            return  ResponseEntity.ok(roleName);
        }

       // return ResponseEntity.ok(lndNodeInfo.getLndNodeRole());

    }
}
