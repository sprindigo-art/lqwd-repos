package com.lqwd.config;

import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Configuration;


/**
 * <p>
 * Essence of this class is to fix the issue were you have variables in some spring beans having @value annotations
 * and @bean annotations as well. Usually multiple beans are created because of the @bean notations in such cases
 * So moving the variables to this class and injecting the class in the parent class with the @bean notation fixed this.
 * </p>
 */
@RefreshScope
@Configuration
@Data
public class KafkaConfigVariables {
    @Value("${spring.kafka.bootstrap-servers}")
    private String bootstrapServers;

    @Value("${spring.cloud.stream.bindings.input.group}")
    private String groupId;

    @Value("${kafka.binder.schema-registry-url}")
    private String schemaRegistryUrl;

    @Value("${spring.kafka.enable.auto.commit}")
    private String enableAutoCommit;

    @Value("${spring.kafka.auto.commit.interval.ms}")
    private String autoCommitIntervalMs ;

    @Value("${spring.kafka.session.timeout.ms}")
    private String sessionTimeoutMs ;

    @Value("${spring.kafka.consumer.timeout.ms}")
    private String consumerTimeoutMs;

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

    @Value("${spring.cloud.stream.default.consumer.useNativeEncoding}")
    private String useNativeEncoding;

    @Value("${kafka.listener.auto-startup:true}")
    private boolean listenerAutoStartup;

}