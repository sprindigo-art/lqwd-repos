package com.lqwd.producer;

import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageKey;
import io.confluent.kafka.serializers.KafkaAvroDeserializerConfig;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class KafkaProducerConfig {

    @Value("${spring.kafka.bootstrap-servers}")
    private String bootstrapServers;

    @Value("${spring.cloud.stream.bindings.input.group}")
    private String groupId;

    @Value("${spring.cloud.stream.kafka.binder.consumer-properties.schema.registry.url}")
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

    @Value("${spring.cloud.stream.kafka.binder.producer-properties.key.serializer}")
    private String keySerializer;

    @Value("${spring.cloud.stream.kafka.binder.producer-properties.value.serializer}")
    private String valueSerializer;


    @Value("${spring.cloud.stream.kafka.binder.consumer-properties.key.deserializer}")
    private String keyDeserializer;

    @Value("${spring.cloud.stream.kafka.binder.consumer-properties.value.deserializer}")
    private String valueDeserializer;


    @Value("${spring.cloud.stream.kafka.binder.consumer-properties.specific.avro.reader}")
    private String avroReader;

    @Value("${spring.cloud.stream.default.consumer.useNativeEncoding}")
    private String useNativeEncoding;

    @Bean
    public Map<String, Object> producerConfigs() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, groupId);

        props.put("enable.auto.commit", enableAutoCommit);
        props.put("auto.commit.interval.ms", autoCommitIntervalMs);
        props.put("session.timeout.ms", sessionTimeoutMs);
        props.put("consumer.timeout.ms", consumerTimeoutMs);


        props.put("jaas.enabled", jaasEnabled);
        props.put("security.protocol", securityProtocol);
        props.put("sasl.mechanism", saslMechanism);
        props.put("sasl.jaas.config", saslJaasConfig);

        props.put("key.serializer", keySerializer);
        props.put("value.serializer", valueSerializer);
        props.put("key.deserializer", keyDeserializer);
        props.put("value.deserializer", valueDeserializer);
        props.put("schema.registry.url", schemaRegistryUrl);
        props.put(KafkaAvroDeserializerConfig.SPECIFIC_AVRO_READER_CONFIG, avroReader);

        return props;
    }

    @Bean
    public ProducerFactory<String, Tmessage> producerFactory() {
        return new DefaultKafkaProducerFactory<>(producerConfigs());
    }

    @Bean
    public KafkaTemplate<String, Tmessage> kafkaTemplate() {
        return new KafkaTemplate<>(producerFactory());
    }

}
