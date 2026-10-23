package com.lqwd.service;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.entities.UserActivity;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.repository.UserActivityRepository;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;

@Service
@RequiredArgsConstructor
public class UserActivityService {

    private final static Logger logger = LoggerFactory.getLogger(LiquidityService.class);


    private final UserActivityRepository userActivityRepository;
    private final HttpServletRequest request;
    private final HttpClientToken httpClientToken;
    private final AccessTokenServiceHelper accessTokenServiceHelper;


    public UserActivity save(UserActivity userActivity) {
        return userActivityRepository.save(userActivity);
    }

    private Page<UserActivity> findAll(Pageable pageable){
        return userActivityRepository.findAll(pageable);
    }

    public ApiResponse<PageResponse<UserActivity>> findAll (int pageNumber, int pageSize){
        Page<UserActivity> page = findAll(PageRequest.of(pageNumber,pageSize, Sort.by("dateCreated")));
        PageResponse data = new PageResponse<>(page.getNumber(),page.getSize()
                ,page.getTotalElements(),page.getContent(), page.getTotalPages());
        return new ApiResponse<>(
                data,
                "Request successful");
    }

    public UserActivity logUserActivity(String userId,String username, String activity){
        String userIp = UserUtil.getClientIP(request);
        return  save(new UserActivity(activity,userId,username,userIp));
    }

    public UserActivity logUserActivityWithToken(String token,String username, String activity){
        String userIp = UserUtil.getClientIP(request);
        MainResponse userinfo = httpClientToken.userInfo(
                token);

        String userId = null;
        if(userinfo.getStatus() == 200) {
            try {
                userId = UserUtil.retrieveUserId(userinfo.getObject());
            } catch (JSONException e) {
                logger.info("couldn't retrieve userId: {}", e.getMessage());
            }
        }

        return  save(new UserActivity(activity,userId,username,userIp));
    }

    public ApiResponse<PageResponse<UserActivity>> getUserActivity(String userId, int pageNumber, int pageSize)
    {
        Page<UserActivity> page = userActivityRepository.
                findByUserId(userId, PageRequest.of(pageNumber,pageSize, Sort.by("dateCreated")));

        PageResponse data = new PageResponse<>(page.getNumber(),page.getSize()
                ,page.getTotalElements(),page.getContent(), page.getTotalPages());
        return new ApiResponse<>(
                data,
                "Request successful");
    }

    public ApiResponse<PageResponse<UserActivity>> getUserActivity(OAuth2Authentication authentication,
                                                                   int pageNumber, int pageSize) throws JSONException {

        MainResponse userinfo = httpClientToken.userInfo(
                accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication));

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

      return getUserActivity(userId,pageNumber,pageSize);

    }




}
