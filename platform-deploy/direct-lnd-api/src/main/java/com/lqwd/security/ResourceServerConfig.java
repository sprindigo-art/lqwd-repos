package com.lqwd.security;

import com.lqwd.config.AppProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.config.annotation.web.configuration.EnableResourceServer;
import org.springframework.security.oauth2.config.annotation.web.configuration.ResourceServerConfigurerAdapter;
import org.springframework.security.oauth2.config.annotation.web.configurers.ResourceServerSecurityConfigurer;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.Arrays;

@Configuration
@EnableResourceServer
@RequiredArgsConstructor
public class ResourceServerConfig extends ResourceServerConfigurerAdapter {

    private final AppProperties appProperties;

    @Override
    public void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()

                .antMatchers("/login/**",
                        "/api/v1/application/verify_token",

                        "/api/v1/verification/send_phone_number_otp").permitAll().and()

                .authorizeRequests()
                .antMatchers(HttpMethod.POST,"/api/v1/staking/**")//Ensure only staking roles can access this endpdoint
                .hasAuthority("STAKING").and()
                .authorizeRequests()
                .antMatchers("/api/v1/liquidity","/api/v1/liquidity/finalize")//Ensure only liquidity roles can access this endpdoint
                .hasAuthority("LIQUIDITY").and()
                .authorizeRequests().antMatchers("/**").hasAnyAuthority("USER", "ADMIN").anyRequest().anonymous();;
    }

    @Override
    public void configure(ResourceServerSecurityConfigurer resources) {
        resources.resourceId(appProperties.getResource_id());
    }

    @Bean
    public FilterRegistrationBean<CorsFilter> corFilter() {

        String[] origins = appProperties.getAllowed_origins().split(",");

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();

        CorsConfiguration corsConfiguration = new CorsConfiguration();
        corsConfiguration.setAllowCredentials(true);
        corsConfiguration.addAllowedHeader("*");
        corsConfiguration.setAllowedOrigins(Arrays.asList(origins));
        corsConfiguration.setAllowedMethods(Arrays.asList("POST", "GET", "DELETE", "PUT"));
        corsConfiguration.setMaxAge(3600L);
        source.registerCorsConfiguration("/**", corsConfiguration);

        FilterRegistrationBean<CorsFilter> bean = new FilterRegistrationBean<>(new CorsFilter(source));
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);

        return bean;
    }

}