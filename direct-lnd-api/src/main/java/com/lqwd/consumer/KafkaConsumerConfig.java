package com.lqwd.consumer;

import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageKey;
import io.confluent.kafka.schemaregistry.client.CachedSchemaRegistryClient;
import io.confluent.kafka.schemaregistry.client.SchemaRegistryClient;
import io.confluent.kafka.serializers.KafkaAvroDeserializer;
import io.confluent.kafka.serializers.KafkaAvroDeserializerConfig;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.Deserializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.codehaus.jackson.map.annotate.JsonDeserialize;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.stream.schema.SchemaReference;
import org.springframework.cloud.stream.schema.SchemaRegistrationResponse;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.support.serializer.ErrorHandlingDeserializer2;
import org.springframework.kafka.support.serializer.JsonDeserializer;

import java.util.HashMap;
import java.util.Map;

@EnableKafka
@Configuration
public class KafkaConsumerConfig {

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
    public Map<String, Object> consumerConfigs() {
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
        props.put("key.default_type", "TmessageKey");
        props.put("schema.registry.url", schemaRegistryUrl);
        props.put("bindings.output.content-type", "application/*+avro");


        props.put(KafkaAvroDeserializerConfig.SPECIFIC_AVRO_READER_CONFIG, avroReader);

        return props;
    }
    @Bean
    public ConsumerFactory<TmessageKey, Tmessage> consumerFactory() {

        ErrorHandlingDeserializer2<Tmessage> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer2(new KafkaAvroDeserializer(schemaRegistryClient2(schemaRegistryUrl)));

        ErrorHandlingDeserializer2<TmessageKey> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer2(new KafkaAvroDeserializer(schemaRegistryClient2(schemaRegistryUrl)));

        return new DefaultKafkaConsumerFactory<TmessageKey, Tmessage>(consumerConfigs(), (Deserializer) errorHandlingDeserializerKey, errorHandlingDeserializer2);
    }

    @Bean
    public ConsumerFactory<String, String> consumerFactoryString() {

        ErrorHandlingDeserializer2<String> errorHandlingDeserializer2 =
                new ErrorHandlingDeserializer2(new StringDeserializer());

        ErrorHandlingDeserializer2<String> errorHandlingDeserializerKey =
                new ErrorHandlingDeserializer2(new StringDeserializer());

        return new DefaultKafkaConsumerFactory<String, String>(consumerConfigs(), (Deserializer) errorHandlingDeserializerKey, errorHandlingDeserializer2);
    }

    @Bean("kafkaListenerContainerFactory")
    public ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage> kafkaListenerContainerFactory() {
        ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage> factory = new ConcurrentKafkaListenerContainerFactory<TmessageKey, Tmessage>();
        factory.setConsumerFactory(consumerFactory());
        return factory;
    }

    @Bean("kafkaListenerContainerFactoryString")
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactoryString() {
        ConcurrentKafkaListenerContainerFactory<String, String> factory = new ConcurrentKafkaListenerContainerFactory<String, String>();
        factory.setConsumerFactory(consumerFactoryString());
        return factory;
    }


    @Bean
    public SchemaRegistryClient schemaRegistryClient2(@Value("${spring.cloud.stream.kafka.binder.consumer-properties.schema.registry.url}") String endpoint){
        final SchemaRegistryClient client = new CachedSchemaRegistryClient(endpoint,1);
        return client;
    }
}
