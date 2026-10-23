package com.lqwd.messaging.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Component;

@Component
@Data
@ConfigurationProperties(prefix = "app")
@RefreshScope
public class AppProperties {

    private String redisHost;
    private int redisPort;
    private String redisCred;

}