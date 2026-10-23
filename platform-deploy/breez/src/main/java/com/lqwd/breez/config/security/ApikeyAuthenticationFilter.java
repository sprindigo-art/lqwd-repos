package com.lqwd.breez.config.security;

import com.lqwd.breez.exceptions.ApiException;
import com.lqwd.breez.service.OauthServerApiService;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.GenericFilterBean;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * Custom Authentication Filter Bean
 * Checks For X-API-KEY in all inbound requests.
 */
@RequiredArgsConstructor
public class ApikeyAuthenticationFilter extends GenericFilterBean {

    private final  OauthServerApiService oauthService;

    static final String HEADER_API_KEY="X-API-KEY";



    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;

        if(request.getHeader(HEADER_API_KEY) == null){
            sendErrorResponse(response, HttpStatus.SC_BAD_REQUEST,"Please provide "+HEADER_API_KEY+" in request header");
        }else{
            String apiKey = request.getHeader(HEADER_API_KEY);

            try {
                oauthService.authorizeViaApiKey(apiKey);
                ApikeyAuthentication authentication = new ApikeyAuthentication(new ApikeyAuthenticationPrincipal());
			    SecurityContextHolder.getContext().setAuthentication(authentication);

                filterChain.doFilter(request, response);
            }catch(IOException ex){
                sendErrorResponse(response, HttpStatus.SC_INTERNAL_SERVER_ERROR,"unknown error");
            }catch(ApiException ex){
                sendErrorResponse(response, ex.getStatus(),ex.getMessage() != null? ex.getMessage() : "Unknown error");

            }
        }
    }

    private void sendErrorResponse(HttpServletResponse response, int status, String message){
        response.setStatus(status);
        try {
            response.getWriter().write(message);
        } catch (IOException e) {
            //logger here
        }
    }
}
