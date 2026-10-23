package com.lqwd.security.oauth2.config.server;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.service.UserService;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.handler.HandlerInterceptorAdapter;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Date;

/**
 * Application web interceptor
 * For now this interceptor is used to log to the last_Access time for a user
 * Could be extended to be used for other future features
 *
 */
@Component
@RequiredArgsConstructor
public class ServerHttpRequestInterceptor extends HandlerInterceptorAdapter{

    private final UserService userService;


    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        //check is user is authenticated
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        User_ user = null;

        if(auth != null){
            user = userService.findByUsernameOrEmail(auth.getName()).orElse(null);
        }

        if(user != null){
            //if user authenticated, set access time
            user.setLastAccessDate(new java.sql.Timestamp(System.currentTimeMillis()));
            userService.saveUser(user);
        }
        return super.preHandle(request, response, handler);
    }
}
