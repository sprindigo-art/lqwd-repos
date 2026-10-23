package com.lqwd.security.oauth2.controller;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.lqwd.security.oauth2.model.response.ApikeyResponse;
import com.lqwd.security.oauth2.model.response.ErrorResponse;
import com.lqwd.security.oauth2.model.security.ApiKey;
import com.lqwd.security.oauth2.model.security.LndNodeInfo;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.service.ApiKeyService;
import com.lqwd.security.oauth2.service.LndNodeInfoService;
import com.lqwd.security.oauth2.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.constraints.NotBlank;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;

@RestController
@RequestMapping("/apikey")
@RequiredArgsConstructor
public class ApiKeyController {


    private final UserService userService;
    private final ApiKeyService apiKeyService;
    private final LndNodeInfoService lndNodeInfoService;
    private final PasswordEncoder userPasswordEncoder;


    @GetMapping("/authorize")
    public ResponseEntity apiKeyInfo(@RequestParam String apikey) {

        ApiKey apiKey = apiKeyService.checkApikey(apikey);

        if (apiKey != null && apiKey.getUser() != null)
            return ResponseEntity.status(HttpStatus.OK).body("Authorized");

        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Api key not found");

    }


    @PostMapping(value = "/check")
    public ResponseEntity<ApikeyResponse> checkApikey(@RequestParam String apikey,
                                                      @RequestParam String lndNodeName) throws Exception {

        ApiKey apiKey = apiKeyService.checkApikey(apikey);

        if (apiKey == null)
            return ResponseEntity.badRequest().body(new ApikeyResponse("Api not found"));

        if (apiKey.getUser() == null)
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new ApikeyResponse("Not authorized to view details of this Api key"));

        ApikeyResponse apikeyResponse = new ApikeyResponse(apiKey);
        User_ user = apiKey.getUser();
        if (user.getAccountInfo() != null) {
            apikeyResponse.setAccountplan(user.getAccountInfo().getPlan());
            apikeyResponse.setAccountstatus(user.getAccountInfo().getStatus());
        } else {
            apikeyResponse.setAccountplan("free");
            apikeyResponse.setAccountstatus("active");
        }
        LndNodeInfo lndNodeInfo = lndNodeInfoService.getLndNodeByName(user, lndNodeName);
        if (lndNodeInfo != null && lndNodeInfo.getLndnodename() != null) {
            apikeyResponse.setLndnodename(lndNodeInfo.getLndnodename());
            apikeyResponse.setLndNodeName(lndNodeInfo.getLndnodename());
            apikeyResponse.setPort(lndNodeInfo.getPort());
            apikeyResponse.setNamespace(lndNodeInfo.getNamespace());
        }
        return ResponseEntity.ok(apikeyResponse);


    }


    @PostMapping(value = "/deactivate")
    public ResponseEntity<ApikeyResponse> deactivateApikey(OAuth2Authentication authentication,
                                                           @RequestParam String apikey,
                                                           @RequestParam @NotBlank String password) {

        User_ user = userService.findByUsernameOrEmail(authentication.getName()).orElse(
                null
        );

        if (user == null)
            return ResponseEntity.badRequest().body(
                    new ApikeyResponse("Sorry, we couldn't find the user associated with this request"));


        if (!userPasswordEncoder.matches(password, user.getPassword()))
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(
                    new ApikeyResponse("Invalid credentials, please try again"));

        ApiKey apiKeyObj = apiKeyService.checkApikey(apikey);

        if (apiKeyObj == null)
            return ResponseEntity.badRequest().body(new ApikeyResponse("Invalid api key"));

        if (apiKeyObj.getUser() == null || !apiKeyObj.getUser().getId().equals(user.getId()))
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new ApikeyResponse("Not authorized to deactivate this Api key"));

        apiKeyService.deactivateApikey(apiKeyObj);

        return ResponseEntity.ok(new ApikeyResponse(apiKeyObj));


    }


    @PostMapping(value = "/addone")
    public ResponseEntity<ApikeyResponse> addone(OAuth2Authentication authentication, @RequestParam String apikey) throws Exception {
        ApiKey apiKeyObj = apiKeyService.checkApikey(apikey);

        if (apiKeyObj == null)
            return ResponseEntity.badRequest().body(new ApikeyResponse("Error apikey"));

        if (apiKeyObj.getUser() == null || !apiKeyObj.getUser().getUsername().equals(authentication.getName()))
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ApikeyResponse("Not authorized to view details of this Api key"));

        apiKeyService.addoneApikey(apiKeyObj);
        return ResponseEntity.ok(new ApikeyResponse(apiKeyObj));

    }


    @PostMapping(value = "/generate")
    public ResponseEntity<?> createApikey(OAuth2Authentication authentication,
                                          @RequestParam @NotBlank String password) throws Exception {

        User_ user = userService.findByUsernameOrEmail(authentication.getName()).orElse(
                null
        );

        if (user == null)
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("Sorry, we couldn't find the user associated with this request").build());


        if (!userPasswordEncoder.matches(password, user.getPassword()))
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(ErrorResponse.builder().error(true)
                    .message("Invalid credentials, please try again").build());

        String apikey = userService.generateApikey(user);

        return ResponseEntity.ok(new ApikeyResponse(apikey));

    }


    @PostMapping(value = "/getlist")
    public ResponseEntity<?> getApikeys(OAuth2Authentication authentication) {

        User_ user = userService.findByUsernameOrEmail(authentication.getName()).orElse(
                null
        );

        if (user == null)
            return ResponseEntity.badRequest().body(ErrorResponse.builder().error(true)
                    .message("Token expired or wrong").build());

        Gson gson = new GsonBuilder().setDateFormat("yyyy-MM-dd").create();
        Collection<ApiKey> apiKeys = user.getApiKeys();

        ArrayList<ApikeyResponse> apiKeyArrayList = new ArrayList<>();
        Iterator iterator = apiKeys.iterator();
        while (iterator.hasNext()) {
            ApiKey apiKey = (ApiKey) iterator.next();
            ApikeyResponse apikeyResponse = new ApikeyResponse(apiKey);
            apiKeyArrayList.add(apikeyResponse);
        }
        String jsonApiKeys = gson.toJson(apiKeyArrayList);
        return ResponseEntity.ok(new ApikeyResponse(jsonApiKeys));
    }


}
