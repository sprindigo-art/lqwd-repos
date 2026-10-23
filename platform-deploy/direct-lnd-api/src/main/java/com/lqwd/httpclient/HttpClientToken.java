package com.lqwd.httpclient;

import com.google.gson.Gson;
import com.lqwd.config.AppProperties;
import com.lqwd.model.entities.LndConfig;
import com.lqwd.model.entities.LndCreationStatusLog;
import com.lqwd.model.enums.DeploymentType;
import com.lqwd.model.request.*;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;
import org.apache.http.message.BasicNameValuePair;
import org.json.JSONArray;
import org.json.JSONException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;


@Service
@RequiredArgsConstructor
public class HttpClientToken {



    private final  HttpClientUtility httpClientUtility;
    private final AppProperties properties;


    private final static Logger logger = LoggerFactory.getLogger(HttpClientToken.class);


    public MainResponse getTokenClientCredentials(String clientId, String clientSecret) throws IOException {

        HttpPost postRequest = httpClientUtility.getHttpPost("/oauth/token", clientId,clientSecret);

        MultipartEntityBuilder multipartEntityBuilder = MultipartEntityBuilder
                .create()
                .addPart("grant_type", new StringBody("client_credentials", ContentType.MULTIPART_FORM_DATA));

        HttpEntity entity = multipartEntityBuilder.build();
        postRequest.setEntity(entity);

        postRequest.addHeader(HttpHeaders.ACCEPT, "*/*");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "TokenKey", logger);

        return mainResponse;
    }

    public MainResponse getToken(HashMap<String, String> parts) {
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/oauth/token", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "*/*");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "TokenKey", logger);
        return mainResponse;
    }

    public MainResponse refreshToken(String refreshToken) throws IOException {

        HashMap<String, String> parts = new HashMap<>();
        parts.put("grant_type", "refresh_token");
        parts.put("refresh_token", refreshToken);
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/oauth/token", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "*/*");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "TokenKey", logger);
        return mainResponse;
    }


    public MainResponse getClientToken() throws IOException {
        HashMap<String, String> parts = new HashMap<>();
        parts.put("grant_type", "client_credentials");
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/oauth/token", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "*/*");
        return httpClientUtility.httpConnection(postRequest, "TokenKey", logger);

    }

    public MainResponse apikeys(String token, HashMap<String, String> parts,
                                String action) {

        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.AUTHORIZATION,"Bearer "+token);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "Apikey", logger);
        return mainResponse;
    }


    public CheckTokenResponse getNodeInfo(String token) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);

        HttpPost postRequest = httpClientUtility.getNewHttpPost("/oauth/check_token", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "*/*");
        CheckTokenResponse checkTokenResponse = httpClientUtility.httpCheckToken(postRequest, logger);

        return checkTokenResponse;
    }

    public MainResponse getNodeInfo(String token, String lndNodeName) throws JSONException {
        MainResponse mainResponse = lndNodeInfo(token, lndNodeName,"/lndnode/getinfo", "LndNodeInfo");

        return mainResponse;
    }


    public MainResponse deactivate(String token, String apikey,
                                   String password) {

        HashMap<String, String> parts = new HashMap<>();
        parts.put("apikey", apikey);
        parts.put("password", password);

        HttpPost postRequest = httpClientUtility.getNewHttpPost("/apikey/deactivate", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "Apikey", logger);

        return mainResponse;
    }

    public MainResponse checkApikey(String apikey, String lndNodeName) {

        HashMap<String, String> parts = new HashMap<>();
        parts.put("apikey", apikey);
        parts.put("lndNodeName", lndNodeName);

        HttpPost postRequest = httpClientUtility.getNewHttpPost("/apikey/check", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "Apikey", logger);

        return mainResponse;
    }

    public MainResponse addOneToCount(String apikey) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("apikey", apikey);

        HttpPost postRequest = httpClientUtility.getNewHttpPost("/apikey/addone", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "Apikey", logger);

        return mainResponse;
    }

    public MainResponse userInfo(String token) {

        HashMap<String, String> parts = new HashMap<>();
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/registration/userinfo", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "UserInfo", logger);

        return mainResponse;
    }

    public MainResponse userInfoById(String token, String id) {
        HashMap<String, String> parts = new HashMap<>();
        parts.put("id", id);
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/registration/userinfobyid", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "UserInfo", logger);

        return mainResponse;
    }

    public MainResponse userInfoByEmail(String token, String email) {
        HashMap<String, String> parts = new HashMap<>();
        parts.put("email", email);
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/registration/userinfobyemail", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "UserInfo", logger);

        return mainResponse;
    }

    public MainResponse sharedUserInfoByEmail(String token, String sharedEmail) {

        HashMap<String, String> parts = new HashMap<>();
        parts.put("sharedEmail", sharedEmail);
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/registration/shareduserinfobyemail", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "UserInfo", logger);

        return mainResponse;
    }

    public MainResponse accountInfo(String token, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }


    public MainResponse lndNodeInfo(String token, String lndName, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        parts.put("lndNodeName", lndName);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);
        return mainResponse;

    }

    public MainResponse findRoleByName(String token, String role, String action, String className) {
        HashMap<String, String> parts = new HashMap<>();

        parts.put("roleName", role);
        parts.put("token", token);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }


    public MainResponse shareLndNode(String token, ShareLndRequest shareLndRequest, String action, String className) throws UnsupportedEncodingException {

//        HashMap<String, String> parts = new HashMap<>();
//
//
//        parts.put("lndNode_id", String.valueOf(shareLndRequest.getLndNodeId()));
//        parts.put("newUser_id", shareLndRequest.getUserId());
//        parts.put("role_id", shareLndRequest.getRole().getUuid_id().toString());

        Oauth2SharedLndRequest oauth2SharedLndRequest = new Oauth2SharedLndRequest();

        oauth2SharedLndRequest.setLndNode_id(String.valueOf(shareLndRequest.getLndNodeId()));
        oauth2SharedLndRequest.setNewUser_id(shareLndRequest.getSharedUserId());
        oauth2SharedLndRequest.setRole_id(shareLndRequest.getRole().getUuid_id().toString());
        HttpPost postRequest = new HttpPost("http://"+properties.getAuth_post_url()+":"
                +properties.getAuth_post_port() + action);

        StringEntity postingString = new StringEntity(new Gson().toJson(oauth2SharedLndRequest));
        postRequest.setEntity(postingString);

//        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);

        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;

    }


    public MainResponse confirmLndNode(String token, String lndName, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();
        parts.put("lndNodeName", lndName);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public MainResponse authenticate(String password, String token) throws UnsupportedEncodingException {

        HttpPost postRequest = new HttpPost("http://"+properties.getAuth_post_url()+":"
                +properties.getAuth_post_port() + "/authorize/authenticate");

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/x-www-form-urlencoded");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);


        List<NameValuePair> param = new ArrayList<>();
        param.add(new BasicNameValuePair("password", password));

        postRequest.setEntity(new UrlEncodedFormEntity(param, "UTF-8"));

        return httpClientUtility.httpConnection(postRequest, "LndNodeInfo", logger);

    }
    public MainResponse lndNodePortUpdate(CreateLndNodeRequest request, String token) throws UnsupportedEncodingException {

        CreateNodeRequest req = new CreateNodeRequest();
        req.setLndNodeName(request.getLndNetwork().getPrefix());
        req.setNetwork(request.getLndNetwork().name());
        req.setRoutingNode(request.isRoutingNode());
        req.setNonCustodial(request.getIsNonCustodial());
        req.setConfirmed(request.getIsConfirmed());
        req.setExternalIp(LndConfig.getExternalIp());
        req.setNodeId(request.getNodeId().toString());
        req.setStatus(LndCreationStatusLog.CREATION_STATUS.CREATING.name());

        req.setKeySendEnabled(request.isKeySendEnabled());

        req.setDeploymentType(request.getDeploymentType());
        req.setWatchtower(String.valueOf(request.isWatchTower()));
        if(request.getDeploymentType().equals(DeploymentType.K8)) {
            req.setNamespace("lqwd-lnd");
        }
        req.setAlias(request.getAlias());

        HttpPost postRequest = new HttpPost("http://"+properties.getAuth_post_url()+":"
                +properties.getAuth_post_port() + "/lndnode/updatenodeport");

        StringEntity postingString = new StringEntity(new Gson().toJson(req));
        postRequest.setEntity(postingString);

        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "LndNodeInfo", logger);

        return mainResponse;

    }

    public MainResponse lndNodeCreate(CreateLndNodeRequest request, String token) throws UnsupportedEncodingException {

        CreateNodeRequest req = new CreateNodeRequest();
        req.setLndNodeName(request.getLndNetwork().getPrefix());
        req.setNetwork(request.getLndNetwork().name());
        req.setRoutingNode(request.isRoutingNode());
        req.setNonCustodial(request.getIsNonCustodial());
        req.setConfirmed(request.getIsConfirmed());
        req.setExternalIp(LndConfig.getExternalIp());

        req.setStatus(LndCreationStatusLog.CREATION_STATUS.CREATING.name());

        req.setKeySendEnabled(request.isKeySendEnabled());

        req.setDeploymentType(request.getDeploymentType());
        req.setWatchtower(String.valueOf(request.isWatchTower()));
        if(request.getDeploymentType().equals(DeploymentType.K8)) {
            req.setNamespace("lqwd-lnd");
        }
        req.setAlias(request.getAlias());

        HttpPost postRequest = new HttpPost("http://"+properties.getAuth_post_url()+":"
                +properties.getAuth_post_port() + "/lndnode/create");

        StringEntity postingString = new StringEntity(new Gson().toJson(req));
        postRequest.setEntity(postingString);

        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "LndNodeInfo", logger);

        return mainResponse;
    }

    public MainResponse createApplication(ApplicationRequest application, String token)  throws UnsupportedEncodingException {
        HashMap<String, String> parts = new HashMap<>();

        parts.put("companyAddress", application.getCompanyAddress());
        parts.put("companyName", application.getCompanyName());
        parts.put("companyUrl",application.getCompanyUrl());
        parts.put("contactEmail", application.getContactEmail());
        parts.put("contactName", application.getContactName());
        parts.put("contactPhone", application.getContactPhone());
        parts.put("countryCode", application.getCountryCode());

        parts.put("currentSolution", application.getCurrentSolution());
        parts.put("goal", application.getGoal());
        parts.put("productInfo", application.getProductInfo());
        parts.put("zipCode", application.getZipCode());
        parts.put("hasKyc", application.isHasKyc()?"true":"false");

        System.out.println(parts.get("contactName"));

        HttpPost postRequest = httpClientUtility.getNewHttpPostJSON("/application/create", parts);
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "LndNodeInfo", logger);
        return mainResponse;
    }

    public MainResponse verifyApplication(String emailAddress, String inviteCode, String token) throws UnsupportedEncodingException {
        HashMap<String, String> parts = new HashMap<>();

        parts.put("emailAddress", emailAddress);
        parts.put("inviteCode", inviteCode);

        HttpPost postRequest = httpClientUtility.getNewHttpPostJSON("/application/verify_token", parts);
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "LndNodeInfo", logger);
        return mainResponse;
    }

    public MainResponse lndNodeAddLit(String token, String lndName, String litNodeName, String action, String className) {
        HashMap<String, String> parts = new HashMap<>();
        parts.put("lndNodeName", lndName);
        parts.put("litNodeName", litNodeName);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);
        return mainResponse;
    }

    public MainResponse lndNodeUpdate(String token, HashMap<String, String> params,
                                      String path, String className) {

        HttpPost postRequest;

        try {
            postRequest = httpClientUtility.getNewHttpPostJSON(path, params);
        } catch (UnsupportedEncodingException e) {
            return new MainResponse(500, "An error occurred when creating json request");
        }

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);

        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public MainResponse lndNodeDelete(String token, String lndName, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        parts.put("lndNodeName", lndName);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public MainResponse lndNodeList(String token, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public Integer lndNodeCounts(String token, String action, String className) throws JSONException {
        Integer count = 0;

        MainResponse mainResponse = lndNodeList(token, action, className);
        if(mainResponse.getObject() != null) {
            JSONArray jsonArray = new JSONArray(mainResponse.getObject());
            count = jsonArray.length();
        }
        return count;
    }

    public MainResponse userUpdate(UserSetting userSetting) throws UnsupportedEncodingException {

        HttpPost postRequest = httpClientUtility.getNewHttpPost("/registration/userinfo/update", userSetting);
        postRequest.addHeader("Content-type", "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "UserInfo", logger);

        return mainResponse;

    }


    public MainResponse saveLndNodeInfo(LndConfig lndConfig, String token, String action, String className) {
        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        parts.put("lndNodeName", lndConfig.getLabel());
        parts.put("externalip", lndConfig.getLndexternalip());
        parts.put("port", lndConfig.getPort8080());
        parts.put("status", lndConfig.getStatus());

        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }



}
