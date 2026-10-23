package com.lqwd.config;

import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageKey;
import io.confluent.kafka.schemaregistry.client.CachedSchemaRegistryClient;
import io.confluent.kafka.schemaregistry.client.SchemaRegistryClient;
import io.confluent.kafka.serializers.KafkaAvroDeserializer;
import lombok.RequiredArgsConstructor;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.Deserializer;
import org.apache.kafka.common.serialization.IntegerDeserializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.listener.BatchLoggingErrorHandler;
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

    @Bean
    public Map<String, Object> batchConsumerConfigs() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, configVariables.getBootstrapServers());
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, configVariables.getKeyDeserializer());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,configVariables.getValueDeserializer());
        props.put(ConsumerConfig.GROUP_ID_CONFIG, configVariables.getGroupId());
        props.put("enable.auto.commit", configVariables.getEnableAutoCommit());
        props.put("auto.commit.interval.ms", configVariables.getAutoCommitIntervalMs());
        props.put("fetch.max.bytes", 52428800);
        props.put("fetch.max.wait.ms", 300000);
        props.put("fetch.min.bytes", 1);
        props.put("security.protocol", configVariables.getSecurityProtocol());
        props.put("sasl.mechanism", configVariables.getSaslMechanism());
        if (!StringUtils.isEmpty(configVariables.getSaslJaasConfig()))
            props.put("sasl.jaas.config", configVariables.getSaslJaasConfig());
        return props;
    }

    @Bean
    public ConsumerFactory<TmessageKey, Tmessage> batchConsumerFactory() {
        ErrorHandlingDeserializer<Tmessage> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer(new KafkaAvroDeserializer(schemaRegistryClient2(
                        configVariables.getSchemaRegistryUrl())));

        ErrorHandlingDeserializer<TmessageKey> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer(new KafkaAvroDeserializer(schemaRegistryClient2(
                        configVariables.getSchemaRegistryUrl())));

        return new DefaultKafkaConsumerFactory<>(batchConsumerConfigs(),
                errorHandlingDeserializerKey, errorHandlingDeserializer2);

    }

    @Bean("kafkaBatchListenerContainerFactory")
    public ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage> kafkaBatchListenerContainerFactory() {
        ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage> factory = new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(batchConsumerFactory());
        factory.getContainerProperties().setIdleBetweenPolls(300000);
        factory.setBatchListener(true);
        factory.setBatchErrorHandler(new BatchLoggingErrorHandler());
        return factory;
    }

    @RefreshScope
    @Bean
    public ConsumerFactory<TmessageKey, Tmessage> consumerFactory() {

        ErrorHandlingDeserializer<Tmessage> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer(new KafkaAvroDeserializer(schemaRegistryClient2(
                        configVariables.getSchemaRegistryUrl())));

        ErrorHandlingDeserializer<TmessageKey> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer(new KafkaAvroDeserializer(schemaRegistryClient2(
                        configVariables.getSchemaRegistryUrl())));

        return new DefaultKafkaConsumerFactory<TmessageKey, Tmessage>(consumerConfigs(),
                (Deserializer) errorHandlingDeserializerKey, errorHandlingDeserializer2);
    }


    @Bean
    public ConsumerFactory<String, String> consumerFactoryString() {

        ErrorHandlingDeserializer<String> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer(new StringDeserializer());

        ErrorHandlingDeserializer<String> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer(new StringDeserializer());

        return new DefaultKafkaConsumerFactory<>(consumerStringConfigs(),
                errorHandlingDeserializerKey, errorHandlingDeserializer2);
    }


    @Bean("kafkaListenerContainerFactory")
    public ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage> kafkaListenerContainerFactory() {
        ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage> factory = new
                ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage>();
        factory.setConsumerFactory(consumerFactory());
        factory.setConcurrency(10);
        factory.setAutoStartup(configVariables.isListenerAutoStartup());
        return factory;
    }


    @Bean("kafkaListenerContainerFactoryString")
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactoryString() {
        ConcurrentKafkaListenerContainerFactory<String, String> factory = new ConcurrentKafkaListenerContainerFactory<String, String>();
        factory.setConsumerFactory(consumerFactoryString());
        factory.setAutoStartup(configVariables.isListenerAutoStartup());
        return factory;
    }

    @Bean("kafkaListenerContainerFactoryIntString")
    ConcurrentKafkaListenerContainerFactory<Integer, String> kafkaListenerContainerFactoryIntString(
            ConsumerFactory<Integer, String> consumerFactory) {
        ConcurrentKafkaListenerContainerFactory<Integer, String> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactoryIntString());
        return factory;
    }

    @Bean
    public ConsumerFactory<Integer, String> consumerFactoryIntString() {
        ErrorHandlingDeserializer<Integer> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer(new IntegerDeserializer());

        ErrorHandlingDeserializer<String> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer(new StringDeserializer());

        return new DefaultKafkaConsumerFactory<Integer, String>(consumerConfigs(),
                errorHandlingDeserializerKey, errorHandlingDeserializer2);

    }

    @RefreshScope
    @Bean
    public SchemaRegistryClient schemaRegistryClient2(@Value("${kafka.binder.schema-registry-url}") String endpoint) {
        final SchemaRegistryClient client = new CachedSchemaRegistryClient(endpoint, 1);
        return client;
    }

}
