package com.lqwd.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Component;

@Component
@Data
@ConfigurationProperties(prefix = "node")
@RefreshScope
public class NodeProperties {

    private String externalHost;
    private String externalIp;
    private int postgresEnabled;
    private String namespace;
    private int forceUpdateConfig;
    private int nonCustodialEnabled;
}