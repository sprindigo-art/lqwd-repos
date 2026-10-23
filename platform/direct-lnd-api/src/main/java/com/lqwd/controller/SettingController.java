package com.lqwd.controller;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.entities.CommandHistory;
import com.lqwd.model.User;
import com.lqwd.model.request.UserSetting;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.AccessTokenServiceHelper;
import com.lqwd.service.CommandHistoryService;
import com.lqwd.service.UserActivityService;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import java.io.IOException;
import java.util.HashMap;
import java.util.Optional;


@RestController
@RequestMapping(value = "/setting")
@RequiredArgsConstructor
public class SettingController {


    private final HttpClientToken httpClientToken;
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final CommandHistoryService commandHistoryService;
    private final UserActivityService userActivityService;


    @PostMapping(path = "/token/check")
    public ResponseEntity<MainResponse> tokenCheck(@RequestBody @Valid User user) {

        if (user.getToken() == null)
            return ResponseEntity.badRequest().body(new MainResponse(500,
                    "", "", "Username email error"));

        CheckTokenResponse check = httpClientToken.getNodeInfo(user.getToken());
        Gson gson = new GsonBuilder().setDateFormat("yyyy-MM-dd").create();
        return ResponseEntity.ok(new MainResponse(200, "TokenResponse", gson.toJson(check)));

    }

    @GetMapping(path = "/userinfo")
    public ResponseEntity<MainResponse> userInfo(OAuth2Authentication authentication) {

        MainResponse userinfo = httpClientToken.userInfo(
                accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));
        return ResponseEntity.ok(userinfo);

    }

    @ResponseBody
    @PostMapping(path = "/userinfo/update")
    public ResponseEntity<MainResponse> userInfoUpdate(@Valid UserSetting userSetting, OAuth2Authentication authentication) throws IOException, JSONException {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        if (token == null)
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));

        MainResponse mainResponse = httpClientToken.userInfo(token);

        if (mainResponse.getStatus() != 200)
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "",
                    "Token expired/wrong"));


        JSONObject json = new JSONObject(mainResponse.getObject());
        String email = (String) json.get("email");
        String username = (String) json.get("username");

        if (!username.equals(userSetting.getUsername()) && !email.equals(userSetting.getEmail()))
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "",
                    "Username and email cannot be updated on the same request"));


        userSetting.setToken(token);
        mainResponse = httpClientToken.userUpdate(userSetting);

        userActivityService.logUserActivity(UserUtil.retrieveUserId(mainResponse.getObject()),
                username, "Updated profile");

        return ResponseEntity.ok(mainResponse);


    }


    @ResponseBody
    @RequestMapping(path = "/apikey/generate")
    public ResponseEntity<MainResponse> generate(OAuth2Authentication authentication,
                                                 @RequestParam @NotBlank String password) {
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        HashMap<String, String> parts = new HashMap<>();
        parts.put("password", password);

        MainResponse mainResponse = httpClientToken.apikeys(token, parts, "/apikey/generate");

        return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @PostMapping(path = "/apikey/check")
    public ResponseEntity<MainResponse> check(
            @RequestParam("apikey") String apiKey) {
        MainResponse mainResponse = httpClientToken.checkApikey(apiKey, "");
        return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @PostMapping(path = "/apikey/deactivate")
    public ResponseEntity<MainResponse> deactivate(OAuth2Authentication authentication,
                                                   @RequestParam("apikey") String apiKey,
                                                   @RequestParam @NotBlank String password
    ) {
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse mainResponse = httpClientToken.deactivate(token, apiKey, password);
        return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @PostMapping(path = "/apikey/getlist")
    public ResponseEntity<MainResponse> getlist(OAuth2Authentication authentication) {
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse mainResponse = httpClientToken.apikeys(token, new HashMap<>(), "/apikey/getlist");
        return ResponseEntity.ok(mainResponse);

    }

    @ResponseBody
    @PostMapping(path = "/apikey/history")
    public ResponseEntity<Page<CommandHistory>> getHistory(@RequestParam("apikey") String apikey,
                                                           @RequestParam("page") Optional<Integer> pageNumber,
                                                           @RequestParam("size") Optional<Integer> pageSize) throws IOException {

        int currentPage = pageNumber.orElse(1);
        int size = pageSize.orElse(50);

        Page<CommandHistory> commandHistoryPage = commandHistoryService.getCommandHistory(apikey, currentPage, size);
        return ResponseEntity.ok(commandHistoryPage);

    }

}
