package com.lqwd.controller;

import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.AccessTokenServiceHelper;
import lombok.RequiredArgsConstructor;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping(value = "/lndnode")
@RequiredArgsConstructor
public class LndNodeInfoController {

    private final HttpClientToken httpClientToken;
    private final AccessTokenServiceHelper accessTokenServiceHelper;


    @ResponseBody
    @GetMapping(path = "/getinfo")
    public ResponseEntity<MainResponse> lndNodeInfo(@RequestParam String lndname,
                                                    OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse mainResponse = httpClientToken.lndNodeInfo(token, lndname,
                "/lndnode/getinfo", "LndNodeInfo");

        return ResponseEntity.ok(mainResponse);

    }

    @ResponseBody
    @GetMapping(path = "/getlist")
    public ResponseEntity<MainResponse> lndNodeList(OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);


        MainResponse mainResponse = httpClientToken.lndNodeList(token,
                "/lndnode/getlist", "LndNodeInfo");

        return ResponseEntity.ok(mainResponse);

    }

    @ResponseBody
    @GetMapping(path = "/getwatchtower")
    public ResponseEntity<?> watchtowerList(OAuth2Authentication authentication) throws JSONException {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        CheckTokenResponse checkTokenResponse = httpClientToken.getNodeInfo(token);

        if (!checkTokenResponse.isValid())
            return ResponseEntity.badRequest().body("Token wrong or expired");

        MainResponse mainResponse = httpClientToken.lndNodeList(token,
                "/lndnode/getlist", "LndNodeInfo");

        List<JSONObject> watchtowerList = new ArrayList<>();

        if (mainResponse.getObject() != null) {
            JSONArray jsonArray = new JSONArray(mainResponse.getObject());
            for (int i = 0; i < jsonArray.length(); i++) {
                JSONObject jsonObject = jsonArray.getJSONObject(i);
                if (jsonObject.has("watchtower")) {
                    Object watchtower = jsonObject.get("watchtower");
                    if (watchtower.equals("true")) {
                        watchtowerList.add(jsonObject);
                    }
                }
            }
        }

        mainResponse.setObject(watchtowerList.toString());
        return ResponseEntity.ok(mainResponse);

    }
}
