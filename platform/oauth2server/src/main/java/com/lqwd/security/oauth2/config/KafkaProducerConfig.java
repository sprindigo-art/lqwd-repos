package com.lqwd.security.oauth2.config;

import lombok.RequiredArgsConstructor;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;

import java.util.HashMap;
import java.util.Map;


@Configuration
@RequiredArgsConstructor
public class KafkaProducerConfig {

    private final KafkaConfigVariables configVariables;

    @RefreshScope
    @Bean
    public Map<String, Object> producerConfigs() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, configVariables.getBootstrapServers());
        props.put("security.protocol",  configVariables.getSecurityProtocol());
        props.put("sasl.mechanism",  configVariables.getSaslMechanism());
        props.put("sasl.jaas.config",  configVariables.getSaslJaasConfig());
        props.put("key.serializer",  configVariables.getKeySerializer());
        props.put("value.serializer",  configVariables.getValueSerializer());
        props.put("schema.registry.url",  configVariables.getSchemaRegistryUrl());

        return props;
    }

    @Bean
    public ProducerFactory<String, Object> producerFactory() {
        return new DefaultKafkaProducerFactory<>(producerConfigs());
    }

    @Bean
    public KafkaTemplate<String, Object> kafkaTemplate() {
        return new KafkaTemplate<>(producerFactory());
    }

}
