package com.lqwd.security.oauth2.config.server;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.config.annotation.web.configuration.EnableResourceServer;
import org.springframework.security.oauth2.config.annotation.web.configuration.ResourceServerConfigurerAdapter;
import org.springframework.security.oauth2.config.annotation.web.configurers.ResourceServerSecurityConfigurer;

@Configuration
@EnableResourceServer
public class ResourceServerConfiguration extends ResourceServerConfigurerAdapter {

    private static final String RESOURCE_ID = "resource-server-rest-api";
    private static final String SECURED_READ_SCOPE = "#oauth2.hasScope('read')";
    private static final String SECURED_WRITE_SCOPE = "#oauth2.hasScope('write')";
    private static final String SECURED_PATTERN = "/secured/**";
    private static final String ADMIN_PATTERN = "/admin/**";
    private static final String APPLICATION_PATTERN = "/application/**";
    private static final String REGISTRATION_PATTERN = "/registration/**";
    private static final String APIKEY_PATTERN = "/apikey/**";
    private static final String ACCOUNT_PATTERN = "/account/**";
    private static final String LNDNODE_PATTERN = "/lndnode/**";
    private static final String SHARE_PATTERN = "/share/**";

    @Override
    public void configure(ResourceServerSecurityConfigurer resources) {
        resources.resourceId(RESOURCE_ID);
    }

    @Override
    public void configure(HttpSecurity http) throws Exception {
        http.requestMatchers()
                .antMatchers(REGISTRATION_PATTERN)
                .antMatchers(APIKEY_PATTERN)
                .antMatchers(ACCOUNT_PATTERN)
                .antMatchers(SECURED_PATTERN)
                .antMatchers(ADMIN_PATTERN)
                .antMatchers(APPLICATION_PATTERN)
                .antMatchers(LNDNODE_PATTERN)
                .antMatchers(SHARE_PATTERN)
                .antMatchers("/authorize/authenticate")
                .and()
                .authorizeRequests()
                .antMatchers(REGISTRATION_PATTERN).permitAll()
                .antMatchers(APIKEY_PATTERN).permitAll()
                .antMatchers(ACCOUNT_PATTERN).permitAll()
                .antMatchers(LNDNODE_PATTERN).permitAll()
                .antMatchers(SHARE_PATTERN).permitAll()
                .antMatchers("/authorize/authenticate").authenticated()
                .antMatchers(HttpMethod.POST, SECURED_PATTERN)
                .access(SECURED_WRITE_SCOPE)
                .anyRequest().access(SECURED_READ_SCOPE);
    }
}
