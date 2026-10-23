package com.lqwd.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.gson.Gson;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.F2aSecret;
import com.lqwd.model.TokenKey;
import com.lqwd.model.User;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.UserResponse;
import com.lqwd.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.io.IOException;

@RestController
@RequestMapping(value = "/login")
public class AuthenticationController {

    @Autowired
    private HttpClientToken httpClientToken;

    @Autowired
    private UserService userService;

    @ResponseBody
    @PostMapping(path = "/token")
    public ResponseEntity<MainResponse> getToken(HttpServletRequest request,
                             @RequestParam String username, @RequestParam String password) throws IOException {

        User user = new User();
        user.setEmail(username);
        user.setPassword(password);

        MainResponse mainResponse = httpClientToken.getToken(user);


        return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @PostMapping(path = "/token/check")
    public ResponseEntity<MainResponse> checkToken(HttpServletRequest request,
                                                 @RequestParam String token) throws IOException {

        CheckTokenResponse checkTokenResponse = httpClientToken.checkToken(token);

        MainResponse mainResponse = new MainResponse();
        if(checkTokenResponse != null) {
            mainResponse.setStatus(200);
            mainResponse.setClass_name("CheckToken");
            Gson gson = new Gson();
            mainResponse.setObject(gson.toJson(checkTokenResponse));
        } else {
            mainResponse.setStatus(500);
            mainResponse.setError("wrong token");
        }
        return ResponseEntity.ok(mainResponse);
    }
    @ResponseBody
    @PostMapping(path = "/registration")
    public ResponseEntity<MainResponse> registration(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "","Username email error"));
        } else {
            MainResponse mainResponse = userService.saveUser(user);

            if(mainResponse.getStatus() == 200 && mainResponse.getError() == null) {
                mainResponse = httpClientToken.getToken(user);
            } else if(mainResponse.getStatus() == 400) {
                mainResponse.setError("Username already exist!");
            }
            return ResponseEntity.ok(mainResponse);
        }
    }

    @ResponseBody
    @PostMapping(path = "/f2a-secret/save")
    public ResponseEntity<MainResponse> f2aSecretSave(@RequestHeader("token") String token, @Valid F2aSecret f2aSecret, BindingResult bindingResult) throws IOException {
        CheckTokenResponse checkToken = httpClientToken.checkToken(token);
        if(checkToken.isValid()) {
            String action = "save";
            if (bindingResult.hasErrors()) {
                return ResponseEntity.badRequest().body(new MainResponse(500, "", "","Username email error"));
            } else {


                MainResponse mainResponse = userService.saveSecret(f2aSecret, action);


                return ResponseEntity.ok(mainResponse);
            }
        }
        else {
            MainResponse mainResponse = new MainResponse();
            mainResponse.setStatus(500);
            mainResponse.setError("Token problem/or expired");
            return ResponseEntity.ok(mainResponse);
        }

    }

    @ResponseBody
    @PostMapping(path = "/f2a-secret/update")
    public ResponseEntity<MainResponse> f2aSecretUpdate(@RequestHeader("token") String token, @Valid F2aSecret f2aSecret, BindingResult bindingResult) throws IOException {

        CheckTokenResponse checkToken = httpClientToken.checkToken(token);
        if(checkToken.isValid()) {
            String action = "save";
            if (bindingResult.hasErrors()) {
                return ResponseEntity.badRequest().body(new MainResponse(500, "", "","Username email error"));
            } else {


                MainResponse mainResponse = userService.saveSecret(f2aSecret, action);


                return ResponseEntity.ok(mainResponse);
            }
        }
        else {
            MainResponse mainResponse = new MainResponse();
            mainResponse.setStatus(500);
            mainResponse.setError("Token problem/or expired");
            return ResponseEntity.ok(mainResponse);
        }
    }

    @ResponseBody
    @PostMapping(path = "/f2a-secret/get")
    public ResponseEntity<MainResponse> f2aSecretGet(@RequestHeader("token") String token, @Valid F2aSecret f2aSecret, BindingResult bindingResult) throws IOException {

        CheckTokenResponse checkToken = httpClientToken.checkToken(token);
        if(checkToken.isValid()) {
            String action = "get";
            if (bindingResult.hasErrors()) {
                return ResponseEntity.badRequest().body(new MainResponse(500, "", "","Username email error"));
            } else {


                MainResponse mainResponse = userService.getSecret(f2aSecret, action);


                return ResponseEntity.ok(mainResponse);
            }
        }
        else {
            MainResponse mainResponse = new MainResponse();
            mainResponse.setStatus(500);
            mainResponse.setError("Token problem/or expired");
            return ResponseEntity.ok(mainResponse);
        }
    }



    @ResponseBody
    @PostMapping(path = "/username/check")
    public ResponseEntity<MainResponse> usernameCheck(@RequestParam("username") String username) throws IOException {


        String action = "checkusername";
            MainResponse mainResponse = userService.checkUsername(username, action);


                return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @PostMapping(path = "/email/check")
    public ResponseEntity<MainResponse> emailCheck(@RequestParam("email") String email) throws IOException {


        String action = "checkemail";
        MainResponse mainResponse = userService.checkEmail(email, action);


        return ResponseEntity.ok(mainResponse);
    }


    @ResponseBody
    @PostMapping(path = "/verification/send")
    public ResponseEntity<MainResponse> sendVefication(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "","Username email error"));
        } else {
            MainResponse mainResponse = userService.sendVerification(user);
            return ResponseEntity.ok(mainResponse);
        }

    }

    @ResponseBody
    @GetMapping(path = "/confirm-account")
    public ResponseEntity<MainResponse> confirmAccount(@RequestParam("token") String token) throws IOException {

        MainResponse mainResponse = userService.confirmVerification(token);
            return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @PostMapping(path = "/recovery/send")
    public ResponseEntity<MainResponse> recoverySend(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "","Username email error"));
        } else {
            MainResponse mainResponse = userService.recoverySend(user);
            return ResponseEntity.ok(mainResponse);
        }

    }


    @ResponseBody
    @PostMapping(path = "/recovery/password")
    public ResponseEntity<MainResponse> passwordRecoverySend(@Valid User user, BindingResult bindingResult) throws IOException {

        if (bindingResult.hasErrors()) {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "","Username email error"));
        } else {
            MainResponse mainResponse = userService.recoveryUpdate(user);
            if(mainResponse.getStatus()==200){
                user.setToken("");
                mainResponse = httpClientToken.getToken(user);
            }
            return ResponseEntity.ok(mainResponse);
        }

    }

    @ResponseBody
    @PostMapping(path = "/password/update")
    public ResponseEntity<MainResponse> passwordUpdate(@RequestParam("username") String username,
                                                       @RequestParam("old_password") String oldPassword,
                                                       @RequestParam("password") String password) throws IOException {

        User user = new User();
        user.setEmail(username);
        user.setPassword(oldPassword);

        MainResponse mainResponse = httpClientToken.getToken(user);

        if(mainResponse.getStatus() == 200 && mainResponse.getError() == null) {
            mainResponse = userService.updatePassword(username, oldPassword, password);
        }

        user.setPassword(password);

        if(mainResponse.getStatus() == 200 && mainResponse.getError() == null) {
            mainResponse = httpClientToken.getToken(user);
        }

        return ResponseEntity.ok(mainResponse);

    }

}
