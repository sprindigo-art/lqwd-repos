package com.lqwd.controller;

import com.lqwd.model.entities.UserLndChannel;
import com.lqwd.model.request.OpenChannelRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.OpenChannelResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.service.ShareLndService;
import com.lqwd.service.UserLNDChannelService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.io.UnsupportedEncodingException;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class UserLNDChannelController {

    private final UserLNDChannelService lndChannelService;

    private final ShareLndService shareLndService;

    @GetMapping("/v1/user_lnd_channels")
    public PageResponse<UserLndChannel> getUserChannels(
            @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
            @RequestParam(defaultValue = "10", value= "pageSize") int pageSize,
            @RequestParam(required = false, value= "types") String types,
            @RequestParam(required = false, value= "lndname") String lndname,
            @RequestParam(required = false, value= "query") String query,
            OAuth2Authentication authentication) throws Exception {


        if(shareLndService.checkActionLevel(authentication, lndname,"/v1/channel/open_channel")) {
            return lndChannelService.findUserLndChannel(pageNumber, pageSize, lndname,
                    types, query, authentication);
        } else {
            throw new Exception("Access level exception. Please check your access level.");
        }


    }

    @GetMapping("/v1/channel/available")
    public ApiResponse<UserLndChannel> findChannelByNodeNameAndPubkey(
            @RequestParam String lndname,
            @RequestParam String remotePubkey,
            @RequestParam int capacity,
            OAuth2Authentication authentication) throws Exception {

        if(shareLndService.checkActionLevel(authentication, lndname,"/v1/channel/available")) {
            return lndChannelService.findChannelByNodeNameAndPubkey(lndname,remotePubkey,capacity,authentication);
        } else {
            throw new Exception("Access level exception. Please check your access level.");
        }




    }

    @PostMapping(path = "/v1/sync_channels")
    public ApiResponse<String> syncChannels(@RequestParam @Valid String lndname,
                                   OAuth2Authentication authentication) throws Exception {

        if(shareLndService.checkActionLevel(authentication, lndname,"/v1/sync_channels")) {
            return lndChannelService.syncNodeChannels(authentication, lndname);
        } else {
            throw new Exception("Access level exception. Please check your access level.");
        }


    }

    @PostMapping(path = "/v1/channel/open_channel")
    public ApiResponse<OpenChannelResponse> openChannel(@RequestBody @Valid OpenChannelRequest request,
                                                        OAuth2Authentication authentication) throws Exception {

        if(shareLndService.checkActionLevel(authentication, request.getLndname(),"/v1/channel/open_channel")) {
            return lndChannelService.openChannel(request, authentication);
        } else {
            throw new Exception("Access level exception. Please check your access level.");
        }
    }
}
