package com.lqwd.controller;

import com.lqwd.model.entities.HTLCSendReceiveEventLog;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.service.HTLCSendReceiveEventService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class HtlcEventController {

    private final HTLCSendReceiveEventService htlcSendReceiveEventService;


    @GetMapping("/v1/htlc_events")
    public ApiResponse<List<HTLCSendReceiveEventLog>> getHtlcEvents(
            @RequestParam String startDate,
            @RequestParam String endDate,
            OAuth2Authentication authentication) throws JSONException {

        return htlcSendReceiveEventService.findHTLCEvent(startDate, endDate, authentication);

    }

}
