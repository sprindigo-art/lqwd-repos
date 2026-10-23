package com.lqwd.security.oauth2.controller;


import com.lqwd.security.oauth2.model.response.AccountInfoResponse;
import com.lqwd.security.oauth2.model.security.AccountInfo;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.service.AccountInfoService;
import com.lqwd.security.oauth2.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/account")
public class AccountInfoController {

    @Autowired
    private UserService userService;

    @Autowired
    private AccountInfoService accountInfoService;

    @Autowired
    private JavaMailSender javaMailSender;

    @PostMapping(value="/getinfo")
    public ResponseEntity<AccountInfoResponse> getInfo(@RequestParam String token){

        User_ user = userService.checkUserByTokenId(token);

        if(user != null) {
            AccountInfo accountInfo = user.getAccountInfo();

            if (accountInfo == null) {
                accountInfo = new AccountInfo("free", "active");
            }
            return ResponseEntity.ok(new AccountInfoResponse(accountInfo));

        } else {
            return ResponseEntity.ok(null);
        }
    }

}
