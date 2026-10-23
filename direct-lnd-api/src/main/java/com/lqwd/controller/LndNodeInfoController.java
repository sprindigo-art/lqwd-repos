package com.lqwd.controller;

import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.MacaroonV2;
import com.lqwd.model.User;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.LndNodeWatchTowerResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.MacaroonV2Service;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping(value = "/lndnode")
public class LndNodeInfoController {

    @Autowired
    private HttpClientToken httpClientToken;

    @Autowired
    private MacaroonV2Service macaroonV2Service;

    @ResponseBody
    @PostMapping(path = "/getinfo")
    public ResponseEntity<MainResponse> lndNodeInfo(@RequestParam String token, @RequestParam String lnd_name) throws IOException {
        if(token != null){

            MainResponse accountInfo = httpClientToken.lndNodeInfo(token, lnd_name,"/lndnode/getinfo", "LndNodeInfo");

            return ResponseEntity.ok(accountInfo);
        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Token not exist error"));
        }
    }

    @ResponseBody
    @PostMapping(path = "/getlist")
    public ResponseEntity<MainResponse> lndNodeList(@RequestParam String token) throws IOException {
        if(token != null){

            MainResponse mainResponse = httpClientToken.lndNodeList(token, "/lndnode/getlist", "LndNodeInfo");

            return ResponseEntity.ok(mainResponse);
        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Token not exist error"));
        }
    }

    @ResponseBody
    @PostMapping(path = "/getwatchtower")
    public ResponseEntity<?> watchtowerList(@RequestParam String token) throws IOException, JSONException {
        if(token != null) {

            CheckTokenResponse checkTokenResponse = httpClientToken.checkToken(token);
            if (checkTokenResponse.isValid()) {
                MainResponse mainResponse = httpClientToken.lndNodeList(token, "/lndnode/getlist", "LndNodeInfo");
                List<JSONObject> watchtowerList = new ArrayList<>();
                if(mainResponse.getObject() != null) {
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
            } else {
                return ResponseEntity.badRequest().body("Token wrong or expired");
            }
        }
        return ResponseEntity.badRequest().body("Token is null");
    }
}
