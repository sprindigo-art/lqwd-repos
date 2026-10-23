package com.lqwd.security;


import com.lqwd.httpclient.CheckTokenResponse;
import com.lqwd.httpclient.HttpClientToken;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.MalformedJwtException;
import io.jsonwebtoken.UnsupportedJwtException;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class JWTAuthorizationFilter extends OncePerRequestFilter {

    private final String HEADER = "Authorization";
    private final String PREFIX = "Bearer ";

    @Value("${app.auth_post_url}")
    private String appAuthPostUrl;

    @Value("${app.auth_password}")
    private String appAuthPassword;

    @Value("${app.auth_user_name}")
    private String appAuthUserName;

    @Value("${app.auth_post_port}")
    private String appAuthPostPort;


    @Autowired
    private HttpClientToken httpClientToken;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        try {
            if (checkJWTToken(request)) {
                CheckTokenResponse checkTokenResponse = validateToken(request);
                if (checkTokenResponse.isValid()) {
                    setUpSpringAuthentication();
                } else {
                    SecurityContextHolder.clearContext();
                }

                chain.doFilter(request, response);
            } else {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.sendError(HttpServletResponse.SC_FORBIDDEN, "Need token for access");

            }
        } catch (ExpiredJwtException | UnsupportedJwtException | MalformedJwtException e) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.sendError(HttpServletResponse.SC_FORBIDDEN, e.getMessage());
        }
    }

    private CheckTokenResponse validateToken(HttpServletRequest request) {
        String jwtToken = request.getHeader(HEADER).replace(PREFIX, "");
        this.httpClientToken.initHttpClientToken(appAuthPostUrl, appAuthPostPort, appAuthUserName, appAuthPassword);
        return this.httpClientToken.checkToken(jwtToken);

    }


    /**
     * Authentication method in Spring flow
     */
    private void setUpSpringAuthentication() {
        List<String> authorities = new ArrayList<>();
        authorities.add("ROLE_USER");
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                "user", null,
                authorities.stream().map(SimpleGrantedAuthority::new).collect(Collectors.toList()));
        SecurityContextHolder.getContext().setAuthentication(auth);

    }

    private boolean checkJWTToken(HttpServletRequest request) {
        String authenticationHeader = request.getHeader(HEADER);
        if (authenticationHeader == null || !authenticationHeader.startsWith(PREFIX)) {
            return false;
        }
        return true;
    }


}
