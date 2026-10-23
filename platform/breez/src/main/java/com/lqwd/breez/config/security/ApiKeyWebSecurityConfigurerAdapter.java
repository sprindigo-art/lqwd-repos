package com.lqwd.breez.config.security;

import com.lqwd.breez.service.OauthServerApiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.builders.WebSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import org.springframework.security.web.session.ConcurrentSessionFilter;

/**
 * Application Security Config
 *
 * Uses Custom Authentication Filter that uses X-API-KEY in request headers
 * for authentication.
 *
 */
@Configuration
@EnableWebSecurity
public class ApiKeyWebSecurityConfigurerAdapter extends WebSecurityConfigurerAdapter {

    @Autowired
    OauthServerApiService oauthService;

    @Override
    protected void configure(HttpSecurity http) throws Exception {

        http.authorizeRequests()
                .anyRequest().authenticated()
                .and().csrf().disable()
                .addFilterAfter(new ApikeyAuthenticationFilter(oauthService), ConcurrentSessionFilter.class);


    }

    @Override
    public void configure(WebSecurity web) throws Exception {
        web.ignoring().antMatchers("/v2/api-docs",
                "/configuration/ui",
                "/swagger-resources/**",
                "/configuration/security",
                "/swagger-ui.html",
                "/webjars/**");
    }

}
