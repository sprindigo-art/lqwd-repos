package com.lqwd.billing.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;


@Component
@Data
@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private String oauthServerBaseUrl;
    private String clientId;
    private String clientSecret;

}