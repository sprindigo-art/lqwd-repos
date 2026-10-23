package com.lqwd.security.oauth2.config;

import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Configuration;


@RefreshScope
@Configuration
@Data
public class KafkaConfigVariables {
    @Value("${spring.kafka.bootstrap-servers}")
    private String bootstrapServers;

    @Value("${spring.kafka.group}")
    private String groupId;

    @Value("${spring.kafka.auto.commit.interval.ms}")
    private String autoCommitIntervalMs ;

    @Value("${kafka.binder.schema-registry-url}")
    private String schemaRegistryUrl;

    @Value("${spring.kafka.enable.auto.commit}")
    private String enableAutoCommit;

    @Value("${spring.kafka.session.timeout.ms}")
    private String sessionTimeoutMs ;

    @Value("${spring.kafka.jaas.enabled}")
    private String jaasEnabled;

    @Value("${spring.kafka.properties.security.protocol}")
    private String securityProtocol ;

    @Value("${spring.kafka.properties.sasl.mechanism}")
    private String saslMechanism;

    @Value("${spring.kafka.properties.sasl.jaas.config}")
    private String saslJaasConfig ;

    @Value("${kafka.binder.key-serializer}")
    private String keySerializer;

    @Value("${kafka.binder.value-serializer}")
    private String valueSerializer;


    @Value("${kafka.binder.key-deserializer}")
    private String keyDeserializer;

    @Value("${kafka.binder.value-deserializer}")
    private String valueDeserializer;


}