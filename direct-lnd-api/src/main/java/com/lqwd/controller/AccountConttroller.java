package com.lqwd.controller;

import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.User;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.io.IOException;

@RestController
@RequestMapping(value = "/account")
public class AccountConttroller {

    @Autowired
    private HttpClientToken httpClientToken;

    @ResponseBody
    @PostMapping(path = "/getinfo")
    public ResponseEntity<MainResponse> accountInfo(@Valid User user, BindingResult bindingResult) throws IOException {
        if(user.getToken() != null){

            MainResponse accountInfo = httpClientToken.accountInfo(user.getToken(), "/account/getinfo", "AccountInfo");

            return ResponseEntity.ok(accountInfo);
        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500, "", "", "Token not exist error"));
        }
    }
}
