package com.lqwd.controller;

import com.lqwd.model.entities.LndAddress;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.service.LndAddressService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.*;

import java.io.UnsupportedEncodingException;
import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class LndAddressController {

    private final LndAddressService lndAddressService;


    @PostMapping("/v1/lnd_address/{nodeName}/new_address")
    public ApiResponse<LndAddress> createNewAddress(
            @RequestParam(value = "passphrase", required = false) String passphrase,
            @RequestParam String password,
            @PathVariable String nodeName, OAuth2Authentication authentication) throws JSONException, UnsupportedEncodingException {
        return lndAddressService.createNodeAddress(nodeName,passphrase, password, authentication);

    }

    @GetMapping("/v1/lnd_address/{nodeName}")
    public ApiResponse<List<LndAddress>> getAddressesForNode(@PathVariable String nodeName) {

        return lndAddressService.getNodeAddresses(nodeName);

    }
}
