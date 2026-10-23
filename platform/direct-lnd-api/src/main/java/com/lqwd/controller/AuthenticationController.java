package com.lqwd.controller;

import com.google.gson.Gson;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.F2aSecret;
import com.lqwd.model.User;
import com.lqwd.model.request.RegistrationRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.UserActivityService;
import com.lqwd.service.UserService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.HashMap;

@RestController
@RequestMapping(value = "/login")
@RequiredArgsConstructor
public class AuthenticationController {

    private final HttpClientToken httpClientToken;
    private final UserService userService;
    private final UserActivityService userActivityService;

    @PostMapping(path = "/token")
    public ResponseEntity<MainResponse> getToken(@RequestParam @NotBlank String username,
                                                 @RequestParam @NotBlank String password, @RequestParam String mfaCode) throws JSONException {


        HashMap<String, String> parts = new HashMap<>();
        parts.put("grant_type", "password");
        parts.put("username", username);
        parts.put("mfa_code", mfaCode);
        parts.put("password", password);

        MainResponse mainResponse = httpClientToken.getToken(parts);

        if (mainResponse.getStatus() == 200) {
            JSONObject jsonObject = new JSONObject(mainResponse.getObject());
            String token = jsonObject.getString("access_token");
            userActivityService.logUserActivityWithToken(token, username, "Logged in");
        }

        return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);

    }


    @PostMapping(path = "/token/refresh")
    public ResponseEntity<MainResponse> getToken(@RequestParam String refreshToken) throws IOException, JSONException {
        MainResponse mainResponse = httpClientToken.refreshToken(refreshToken);
        return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);
    }


    @PostMapping(path = "/token/check")
    public ResponseEntity<MainResponse> checkToken(@RequestParam String token) {

        CheckTokenResponse checkTokenResponse = httpClientToken.getNodeInfo(token);

        MainResponse mainResponse = new MainResponse();
        if (checkTokenResponse != null) {
            mainResponse.setStatus(200);
            mainResponse.setClass_name("CheckToken");
            Gson gson = new Gson();
            mainResponse.setObject(gson.toJson(checkTokenResponse));
        } else {
            mainResponse.setStatus(500);
            mainResponse.setError("wrong token");
        }

        return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);

    }

    @PostMapping(path = "/registration")
    public ResponseEntity<MainResponse> registration(@RequestBody @Valid RegistrationRequest request)
            throws IOException {

        MainResponse mainResponse = userService.saveUser(request);

        return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);


    }

    @PostMapping(path = "/authorize/check_credentials")
    public ResponseEntity<MainResponse> registration(@RequestParam String username, @RequestParam String password)
            throws IOException {

        MainResponse mainResponse = userService.checkCredentials(username, password);

        if(mainResponse.getStatus() != 200)
            return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);

        return ResponseEntity.ok(mainResponse);

    }


    @PostMapping(path = "/f2a-secret/save")
    public ResponseEntity<MainResponse> f2aSecretSave(@RequestHeader("token") String token,
                                                      @Valid F2aSecret f2aSecret, BindingResult bindingResult) {

        CheckTokenResponse checkToken = httpClientToken.getNodeInfo(token);

        if (!checkToken.isValid()) {
            MainResponse mainResponse = new MainResponse();
            mainResponse.setStatus(500);
            mainResponse.setError("Token problem/or expired");
            return ResponseEntity.ok(mainResponse);
        }


        String action = "save";

        if (bindingResult.hasErrors())
            return ResponseEntity.badRequest().body(new MainResponse(500,
                    "", "", "Username email error"));


        MainResponse mainResponse = userService.saveSecret(f2aSecret, action);


        return ResponseEntity.ok(mainResponse);


    }


    @PostMapping(path = "/f2a-secret/update")
    public ResponseEntity<MainResponse> f2aSecretUpdate(@RequestHeader("token") String token,
                                                        @Valid F2aSecret f2aSecret, BindingResult bindingResult) {

        CheckTokenResponse checkToken = httpClientToken.getNodeInfo(token);

        if (!checkToken.isValid()) {
            MainResponse mainResponse = new MainResponse();
            mainResponse.setStatus(500);
            mainResponse.setError("Token problem/or expired");
            return ResponseEntity.ok(mainResponse);
        }


        if (bindingResult.hasErrors())
            return ResponseEntity.badRequest().body(new MainResponse(500,
                    "", "", "Username email error"));


        MainResponse mainResponse = userService.saveSecret(f2aSecret, "save");


        return ResponseEntity.ok(mainResponse);


    }


    @PostMapping(path = "/f2a-secret/get")
    public ResponseEntity<MainResponse> f2aSecretGet(@RequestHeader("token") String token,
                                                     @Valid F2aSecret f2aSecret, BindingResult bindingResult) {

        CheckTokenResponse checkToken = httpClientToken.getNodeInfo(token);

        if (!checkToken.isValid()) {
            MainResponse mainResponse = new MainResponse();
            mainResponse.setStatus(500);
            mainResponse.setError("Token problem/or expired");
            return ResponseEntity.ok(mainResponse);
        }


        if (bindingResult.hasErrors())
            return ResponseEntity.badRequest().body(new MainResponse(500,
                    "", "", "Username email error"));


        MainResponse mainResponse = userService.getSecret(f2aSecret, "get");


        return ResponseEntity.ok(mainResponse);


    }


    @PostMapping(path = "/username/check")
    public ResponseEntity<MainResponse> usernameCheck(@RequestParam("username") String username) {


        String action = "checkusername";
        MainResponse mainResponse = userService.checkUsername(username, action);


        return ResponseEntity.ok(mainResponse);
    }


    @PostMapping(path = "/email/check")
    public ResponseEntity<MainResponse> emailCheck(@RequestParam("email") String email) {


        String action = "checkemail";
        MainResponse mainResponse = userService.checkEmail(email, action);


        return ResponseEntity.ok(mainResponse);
    }

    @PostMapping(path = "/verification/send")
    public ResponseEntity<MainResponse> sendVerification(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors())
            return ResponseEntity.badRequest().body(new MainResponse(500,
                    "", "", "Username email error"));

        MainResponse mainResponse = userService.sendVerification(user.getUsername());
        return ResponseEntity.ok(mainResponse);


    }

    @GetMapping(path = "/number_of_registered_users")
    public ApiResponse<Long> getRegisterUserCount() {

        return userService.getNumberOfRegisteredUsers();
    }

    @GetMapping(path = "/confirm-account")
    public ResponseEntity<MainResponse> confirmAccount(@RequestParam("token") String token) throws IOException {

        MainResponse mainResponse = userService.confirmVerification(token);
        return ResponseEntity.ok(mainResponse);
    }


    @PostMapping(path = "/recovery/send")
    public ResponseEntity<MainResponse> recoverySend(@RequestParam String identity) throws UnsupportedEncodingException {

        MainResponse mainResponse = userService.recoverySend(identity);

        if (mainResponse.getStatus() != 200)
            return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);


        return ResponseEntity.ok(mainResponse);


    }


    @PostMapping(path = "/recovery/password")
    public ResponseEntity<MainResponse> passwordRecoverySend(@RequestParam String token,
                                                             @RequestParam String password) throws UnsupportedEncodingException {


        MainResponse mainResponse = userService.recoveryUpdate(token, password);

        if (mainResponse.getStatus() != 200)
            return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);


        return ResponseEntity.ok(mainResponse);


    }


    @PostMapping(path = "/password/update")
    public ResponseEntity<MainResponse> passwordUpdate(@RequestParam("username") String username,
                                                       @RequestParam("old_password") String oldPassword,
                                                       @RequestParam("password") String password)
            throws JSONException {


        HashMap<String, String> parts = new HashMap<>();
        parts.put("grant_type", "password");
        parts.put("username", username);
        parts.put("password", oldPassword);

        MainResponse mainResponse = httpClientToken.getToken(parts);

        if (mainResponse.getStatus() == 200 && mainResponse.getError() == null) {
            mainResponse = userService.updatePassword(username, oldPassword, password);
        }


        JSONObject jsonObject = new JSONObject(mainResponse.getObject());
        String token = jsonObject.getString("access_token");

        userActivityService.logUserActivityWithToken(token, username, "Updated password");

        return ResponseEntity.ok(mainResponse);

    }

    @PostMapping("/v1/subscribe")
    public ResponseEntity<ApiResponse> subscribeWaitlist(@RequestParam("email") String email) throws IOException {

        ApiResponse apiResponse = userService.sendSubscribeRequestEmail(email);

        if (apiResponse.getStatus() != 200)
            return ResponseEntity.status(apiResponse.getStatus()).body(apiResponse);


        return ResponseEntity.ok(apiResponse);

    }


}
