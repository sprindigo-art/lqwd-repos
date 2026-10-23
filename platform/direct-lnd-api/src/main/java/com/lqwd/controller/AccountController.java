package com.lqwd.controller;

import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.User;
import com.lqwd.model.response.MainResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.Collection;

@RestController
@RequestMapping(value = "/account")
@RequiredArgsConstructor
public class AccountController {

    private final HttpClientToken httpClientToken;

    @ResponseBody
    @PostMapping(path = "/getinfo")
    public ResponseEntity<MainResponse> accountInfo(@Valid User user) {
        if(user.getToken() != null){

            MainResponse accountInfo = httpClientToken.accountInfo(user.getToken(),
                    "/account/getinfo", "AccountInfo");

            return ResponseEntity.ok(accountInfo);
        } else {
            return ResponseEntity.badRequest().body(new MainResponse(500,
                    "", "", "Token not exist error"));
        }
    }


    @ResponseBody
    @GetMapping(path = "/me")
    public ResponseEntity<UserDetails> accountInfo(OAuth2Authentication auth) {

        UserDetails ud = new UserDetails() {

            @Override
            public Collection<? extends GrantedAuthority> getAuthorities() {
                return auth.getAuthorities();
            }

            @Override
            public String getPassword() {
                return null;
            }

            @Override
            public String getUsername() {
                return auth.getPrincipal().toString();
            }

            @Override
            public boolean isAccountNonExpired() {

                return false;
            }

            @Override
            public boolean isAccountNonLocked() {
                return false;
            }

            @Override
            public boolean isCredentialsNonExpired() {
                return false;
            }

            @Override
            public boolean isEnabled() {
                return auth.isAuthenticated();
            }
        };
        return ResponseEntity.ok(ud);
    }
}