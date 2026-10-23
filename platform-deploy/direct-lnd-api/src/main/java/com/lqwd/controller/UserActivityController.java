package com.lqwd.controller;

import com.lqwd.model.entities.UserActivity;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.service.UserActivityService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class UserActivityController {

    private final UserActivityService userActivityService;


    @GetMapping("/v1/user_activity/get_my_activity")
    public ApiResponse<PageResponse<UserActivity>> getMyActivities(@RequestParam(defaultValue = "0") int pageNumber,
                                                                    @RequestParam(defaultValue = "10") int pageSize,
                                                                    OAuth2Authentication authentication) throws JSONException {

        return userActivityService.getUserActivity(authentication,pageNumber,pageSize);

    }

    @GetMapping("/v1/user_activities")
    public ApiResponse<PageResponse<UserActivity>> getMyActivities(@RequestParam(defaultValue = "0") int pageNumber,
                                                                   @RequestParam(defaultValue = "10") int pageSize,
                                                                   @RequestParam(defaultValue = "") String userId)  {

        if(StringUtils.hasText(userId))
           return userActivityService.getUserActivity(userId,pageNumber,pageSize);

        return  userActivityService.findAll(pageNumber,pageSize);

    }
}
