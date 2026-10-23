package com.lqwd.service;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.entities.HTLCSendReceiveEventLog;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.repository.HTLCSendReceiveEventLogRepository;
import com.lqwd.repository.LspForwardingHistoryRepository;
import com.lqwd.utils.DateUtil;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

@Service
@RequiredArgsConstructor
public class HTLCSendReceiveEventService {

    private final HTLCSendReceiveEventLogRepository  htlcSendReceiveEventLogRepository;
    private final LspForwardingHistoryRepository forwardingHistoryRepository;
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final HttpClientToken httpClientToken;


    public ApiResponse<List<HTLCSendReceiveEventLog>> findHTLCEvent(
            String startDate, String endDate, OAuth2Authentication authentication){

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse userinfo = httpClientToken.userInfo(token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        return findHTLCEvent(startDate, endDate, userId);


    }

    private ApiResponse<List<HTLCSendReceiveEventLog>> findHTLCEvent
            (String startDate, String endDate, String userId) {
        Date start = DateUtil.validateDateFormat(startDate, "dd-MM-yyyy");
        Date end = DateUtil.validateDateFormat(endDate, "dd-MM-yyyy");

        List<HTLCSendReceiveEventLog> logs = htlcSendReceiveEventLogRepository
                .findAllByStartDateAndEndDate(start, end, userId);


        return new ApiResponse<>(logs, "Request successful");
    }


}
