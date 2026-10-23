package com.lqwd.httpclient;

import com.lqwd.model.LndConfig;
import com.lqwd.model.User;
import com.lqwd.model.request.UserSetting;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.StringEntity;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.persistence.criteria.CriteriaBuilder;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.HashMap;


@Service
public class HttpClientToken {


    @Autowired
    private HttpClientUtility httpClientUtility;


    private final static Logger logger = LoggerFactory.getLogger(HttpClientToken.class);


    public MainResponse getToken(User user) throws IOException {

        HashMap<String, String> parts = new HashMap<>();
        parts.put("grant_type", "password");
        parts.put("username", user.getUsernameOrEmail());
        parts.put("password", user.getPassword());
        HttpPost postRequest = httpClientUtility.getNewHttpPost("/oauth/token", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "*/*");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "TokenKey", logger);

        return mainResponse;
    }

    public MainResponse apikeys(User user, String action) throws IOException {

        HashMap<String, String> parts = new HashMap<>();
        if (action.equals("/apikey/generate")) {

            parts.put("grant_type", "password");
            parts.put("username", user.getUsernameOrEmail());
            parts.put("password", user.getPassword());

        } else if (action.equals("/apikey/check")) {
            parts.put("grant_type", "password");
            parts.put("apikey", user.getApikey());

        } else if (action.equals("/apikey/getlist")) {
            parts.put("grant_type", "password");
            parts.put("token", user.getToken());

        }

        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "Apikey", logger);

        return mainResponse;
    }


    public CheckTokenResponse checkToken(String token) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);

        HttpPost postRequest = httpClientUtility.getNewHttpPost("/oauth/check_token", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "*/*");
        CheckTokenResponse checkTokenResponse = httpClientUtility.httpCheckToken(postRequest, logger);

        return checkTokenResponse;
    }

    public MainResponse checkToken(String token, String lndNodeName) throws JSONException {
        MainResponse mainResponse = null;
        CheckTokenResponse checkTokenResponse = checkToken(token);
        if(checkTokenResponse.isValid()){
           mainResponse = lndNodeInfo(token, lndNodeName,"/lndnode/getinfo", "LndNodeInfo");
        }
//        JSONArray jsonArray = new JSONArray(mainResponse.getObject());
//        for(int i = 0; i< jsonArray.length(); i++){
//            JSONObject jsonObject = jsonArray.getJSONObject(i);
//            String jsonObject1 = (String)jsonObject.get("lndNodeName");
//
//            if(jsonObject1.equals(lndNodeName)){
//                jsonObject.put("lndnodename", lndNodeName);
//                mainResponse.setObject(jsonObject.toString());
//                mainResponse.setStatus(200);
//                mainResponse.setClass_name("LndNodeInfo");
//                return mainResponse;
//            }
//        }

        return mainResponse;
    }


    public MainResponse deactivate(String apikey, String username) {

        HashMap<String, String> parts = new HashMap<>();
        parts.put("username", username);
        parts.put("apikey", apikey);

        HttpPost postRequest = httpClientUtility.getNewHttpPost("/apikey/deactivate", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
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
        parts.put("token", token);
//        parts.put("username", "token");
//        parts.put("grant_type", "password");


        HttpPost postRequest = httpClientUtility.getNewHttpPost("/registration/userinfo", parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, "UserInfo", logger);

        return mainResponse;
    }

    public MainResponse accountInfo(String token, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }


    public MainResponse lndNodeInfo(String token, String lndName, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        parts.put("lndNodeName", lndName);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public MainResponse lndNodeCreate(String token, String lndName, String action, String className, String status, boolean watchtower) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        parts.put("lndNodeName", lndName);
        parts.put("status", status);
        parts.put("watchtower", String.valueOf(watchtower));
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public MainResponse lndNodeUpdate(String token, String lndName, String action, String className, String status, String nodePubkey) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        parts.put("lndNodeName", lndName);
        parts.put("status", status);
        parts.put("nodepubkey", nodePubkey);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public MainResponse lndNodeDelete(String token, String lndName, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        parts.put("lndNodeName", lndName);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        MainResponse mainResponse = httpClientUtility.httpConnection(postRequest, className, logger);

        return mainResponse;
    }

    public MainResponse lndNodeList(String token, String action, String className) {

        HashMap<String, String> parts = new HashMap<>();

        parts.put("token", token);
        HttpPost postRequest = httpClientUtility.getNewHttpPost(action, parts);
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
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
