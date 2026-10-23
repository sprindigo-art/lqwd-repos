package com.lqwd.controller;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.request.RegistrationRequest;
import com.lqwd.model.request.ShareLndReactRequest;
import com.lqwd.model.request.ShareLndRequest;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.AccessTokenServiceHelper;
import com.lqwd.service.ShareLndService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.io.IOException;

@RestController
@RequestMapping(value = "/share")
@RequiredArgsConstructor
public class ShareLndController {


    private final ShareLndService shareLndService;

    private final HttpClientToken httpClientToken;
    private final AccessTokenServiceHelper accessTokenServiceHelper;

    @PostMapping(path = "/lnd")
    public ResponseEntity<MainResponse> shareLnd(OAuth2Authentication authentication, @RequestBody ShareLndReactRequest request)
            throws IOException {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.authenticate(request.getPassword(), token);

        if (response.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

        MainResponse mainResponse = shareLndService.shareLnd(request, authentication);

        return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);


    }

    @PostMapping(path = "/lnd/update")
    public ResponseEntity<MainResponse> shareLndUpdate(OAuth2Authentication authentication, @RequestBody @Valid ShareLndReactRequest request)
            throws IOException {


        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.authenticate(request.getPassword(), token);

        if (response.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

        MainResponse mainResponse = shareLndService.shareLndUpdate(request, authentication);

        return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);


    }

    @PostMapping(path = "/lnd/delete")
    public ResponseEntity<MainResponse> shareLndDelete(OAuth2Authentication authentication, @RequestBody @Valid ShareLndReactRequest request)
            throws IOException {


        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.authenticate(request.getPassword(), token);

        if (response.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

        MainResponse mainResponse = shareLndService.shareLndDelete(request, authentication);

        return ResponseEntity.status(mainResponse.getStatus()).body(mainResponse);


    }

    @ResponseBody
    @GetMapping(path = "/getlist")
    public ResponseEntity<MainResponse> lndNodeList(OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse mainResponse = httpClientToken.lndNodeList(token,
                "/share/getlist", "LndNodeInfo");
        return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @GetMapping(path = "/getsharedusers")
    public ResponseEntity<MainResponse> getSharedUsers(OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse mainResponse = httpClientToken.lndNodeList(token,
                "/share/getsharedusers", "SharedUsersPermission");
        return ResponseEntity.ok(mainResponse);
    }

    @ResponseBody
    @GetMapping(path = "/getsharedusers/history")
    public ResponseEntity<MainResponse> getSharedUsersHistory(OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse mainResponse = httpClientToken.lndNodeList(token,
                "/share/getsharedusers/history", "SharedUsersPermission");
        return ResponseEntity.ok(mainResponse);
    }
}
