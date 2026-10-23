package com.lqwd.messaging.config;

import com.lqwd.messaging.schemas.EmailBody;
import io.confluent.kafka.schemaregistry.client.CachedSchemaRegistryClient;
import io.confluent.kafka.schemaregistry.client.SchemaRegistryClient;
import io.confluent.kafka.serializers.KafkaAvroDeserializer;
import lombok.RequiredArgsConstructor;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.Deserializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.support.serializer.ErrorHandlingDeserializer;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;


@EnableKafka
@Configuration
@RequiredArgsConstructor
public class KafkaConsumerConfig {

    private final KafkaConfigVariables configVariables;

    @RefreshScope
    @Bean
    public Map<String, Object> consumerConfigs() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, configVariables.getBootstrapServers());
        props.put(ConsumerConfig.GROUP_ID_CONFIG, configVariables.getGroupId());
        props.put("enable.auto.commit", configVariables.getEnableAutoCommit());
        props.put("auto.commit.interval.ms", configVariables.getAutoCommitIntervalMs());
        props.put("session.timeout.ms", configVariables.getSessionTimeoutMs());
        props.put("security.protocol", configVariables.getSecurityProtocol());
        props.put("sasl.mechanism", configVariables.getSaslMechanism());
        if (!StringUtils.isEmpty(configVariables.getSaslJaasConfig()))
            props.put("sasl.jaas.config", configVariables.getSaslJaasConfig());
        props.put("key.deserializer", configVariables.getKeyDeserializer());
        props.put("value.deserializer", configVariables.getValueDeserializer());

        return props;
    }

    @RefreshScope
    @Bean
    public Map<String, Object> consumerStringConfigs() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, configVariables.getBootstrapServers());
        props.put(ConsumerConfig.GROUP_ID_CONFIG, configVariables.getGroupId());
        props.put("enable.auto.commit", configVariables.getEnableAutoCommit());
        props.put("auto.commit.interval.ms", configVariables.getAutoCommitIntervalMs());
        props.put("session.timeout.ms", configVariables.getSessionTimeoutMs());
        props.put("security.protocol", configVariables.getSecurityProtocol());
        props.put("sasl.mechanism", configVariables.getSaslMechanism());

        return props;
    }

    @RefreshScope
    @Bean
    public ConsumerFactory<String, EmailBody> consumerFactory() {

        ErrorHandlingDeserializer<EmailBody> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer(new KafkaAvroDeserializer(schemaRegistryClient2(configVariables.getSchemaRegistryUrl())));

        ErrorHandlingDeserializer<String> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer(new KafkaAvroDeserializer(schemaRegistryClient2(configVariables.getSchemaRegistryUrl())));

        return new DefaultKafkaConsumerFactory<String, EmailBody>(consumerConfigs(), (Deserializer) errorHandlingDeserializerKey, errorHandlingDeserializer2);
    }


    @Bean
    public ConsumerFactory<String, String> consumerFactoryString() {

        ErrorHandlingDeserializer<String> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer(new StringDeserializer());

        ErrorHandlingDeserializer<String> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer(new StringDeserializer());

        return new DefaultKafkaConsumerFactory<String, String>(consumerStringConfigs(), (Deserializer) errorHandlingDeserializerKey, errorHandlingDeserializer2);
    }


    @Bean("kafkaListenerContainerFactory")
    public ConcurrentKafkaListenerContainerFactory<String, EmailBody> kafkaListenerContainerFactory() {
        ConcurrentKafkaListenerContainerFactory<String, EmailBody> factory = new ConcurrentKafkaListenerContainerFactory<String, EmailBody>();
        factory.setConsumerFactory(consumerFactory());
        return factory;
    }


    @Bean("kafkaListenerContainerFactoryString")
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactoryString() {
        ConcurrentKafkaListenerContainerFactory<String, String> factory = new ConcurrentKafkaListenerContainerFactory<String, String>();
        factory.setConsumerFactory(consumerFactoryString());
        return factory;
    }

    @RefreshScope
    @Bean
    public SchemaRegistryClient schemaRegistryClient2(@Value("${kafka.binder.schema-registry-url}") String endpoint) {
        final SchemaRegistryClient client = new CachedSchemaRegistryClient(endpoint, 1);
        return client;
    }
}
