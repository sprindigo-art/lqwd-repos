package com.lqwd.controller;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.CommandHistory;
import com.lqwd.model.User;
import com.lqwd.model.request.UserSetting;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.CommandHistoryService;
import org.json.JSONException;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.io.IOException;
import java.util.Optional;


@RestController
@RequestMapping(value = "/setting")
public class SettingController {

    @Autowired
    private HttpClientToken httpClientToken;

    @Autowired
    private CommandHistoryService commandHistoryService;


    @ResponseBody
    @PostMapping(path = "/token/check")
    public ResponseEntity<MainResponse> tokenCheck(@Valid User user, BindingResult bindingResult) throws IOException {

        boolean checker = false;
        if (user.getToken() != null) {
            CheckTokenResponse check = httpClientToken.checkToken(user.getToken());
            Gson gson = new GsonBuilder().setDateFormat("yyyy-MM-dd").create();
            return ResponseEntity.ok(new MainResponse(200, "TokenResponse", gson.toJson(check)));
        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        }
    }

    @ResponseBody
    @PostMapping(path = "/userinfo")
    public ResponseEntity<MainResponse> userInfo(@Valid User user, BindingResult bindingResult) throws IOException {


        boolean checker = false;
        if (user.getToken() != null) {
//            CheckTokenResponse checkToken = httpClientToken.checkToken(user.getToken());

            MainResponse userinfo = httpClientToken.userInfo(user.getToken());

            return ResponseEntity.ok(userinfo);
        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        }
    }

    @ResponseBody
    @PostMapping(path = "/userinfo/update")
    public ResponseEntity<MainResponse> userInfoUpdate(@RequestHeader("token") String token, @Valid UserSetting userSetting) throws IOException, JSONException {

        boolean checker = false;
        if (token != null) {

            MainResponse mainResponse = httpClientToken.userInfo(token);
            if (mainResponse.getStatus() == 200) {
                JSONObject json = new JSONObject(mainResponse.getObject());
                String email = (String) json.get("email");
                String username = (String) json.get("username");

                if (userSetting.getUsername().equals(username)) {
                    userSetting.setToken(token);
                    mainResponse = httpClientToken.userUpdate(userSetting);
                    return ResponseEntity.ok(mainResponse);
                } else {
                    if (email.equals(userSetting.getEmail())) {
                        userSetting.setToken(token);
                        mainResponse = httpClientToken.userUpdate(userSetting);
                        return ResponseEntity.ok(mainResponse);
                    }
                    return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username and email cannot be updated on the same request"));
                }

            } else {
                return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Token expired/wrong"));
            }
        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        }
    }

    @ResponseBody
    @PostMapping(path = "/apikey/generate")
    public ResponseEntity<MainResponse> generate(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        } else {
            MainResponse mainResponse = httpClientToken.apikeys(user, "/apikey/generate");
            return ResponseEntity.ok(mainResponse);
        }

    }


    @ResponseBody
    @PostMapping(path = "/apikey/check")
    public ResponseEntity<MainResponse> check(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        } else {
            MainResponse mainResponse = httpClientToken.checkApikey(user.getApikey(), "");

            return ResponseEntity.ok(mainResponse);
        }

    }

    @ResponseBody
    @PostMapping(path = "/apikey/deactivate")
    public ResponseEntity<MainResponse> deactivate(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Username email error"));
        } else {
            User userT = new User();
            userT.setEmail(user.getEmail());
            userT.setPassword(user.getPassword());

            MainResponse mainResponse = httpClientToken.getToken(userT);
            if (mainResponse.getStatus() == 200 && mainResponse.getError() == null) {
                mainResponse = httpClientToken.deactivate(user.getApikey(), user.getEmail());
            }
            return ResponseEntity.ok(mainResponse);
        }

    }

    @ResponseBody
    @PostMapping(path = "/apikey/getlist")
    public ResponseEntity<MainResponse> getlist(@Valid User user, BindingResult bindingResult) throws IOException {

        if (user.getToken() != null) {

            MainResponse mainResponse = httpClientToken.apikeys(user, "/apikey/getlist");

            return ResponseEntity.ok(mainResponse);

        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "token required, null-error"));
        }

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
