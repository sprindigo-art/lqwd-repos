package com.lqwd.security.oauth2.config.server;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@RequiredArgsConstructor
public class ServerMvcConfigurerAdapter implements WebMvcConfigurer {

    private final ServerHttpRequestInterceptor serverHttpRequestInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(serverHttpRequestInterceptor);
    }
}
