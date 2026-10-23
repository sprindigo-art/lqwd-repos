package com.lqwd.consumer;

import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageKey;
import com.lqwd.thread.MessageMapList;
import com.lqwd.thread.TmessagesList;
import org.apache.avro.generic.GenericData;
import org.apache.avro.specific.SpecificData;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.record.Record;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.annotation.PartitionOffset;
import org.springframework.kafka.annotation.TopicPartition;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Service;

@Service
public class KafkaConsumerService {
    private static final Logger logger = LoggerFactory.getLogger(KafkaConsumerService.class);

    @Autowired
    private MessageMapList messageMapList;

//    @KafkaListener(topics = "test", containerFactory = "kafkaListenerContainerFactory")
//    public void listenTest(ConsumerRecord consumerRecord) {
//        this.addToMessageMapList(consumerRecord, "test");
//    }
//
//    @KafkaListener(topics = "fast-logs", containerFactory = "kafkaListenerContainerFactoryString")
//    public void listenFastLogs(ConsumerRecord consumerRecord) {
//        String tlogString = consumerRecord.value().toString();
//        System.out.println(tlogString);
//
//    }
//    @KafkaListener(topics = "error-logs", containerFactory = "kafkaListenerContainerFactoryString")
//    public void listenErrorLogs(ConsumerRecord consumerRecord) {
//        String tlogString = consumerRecord.value().toString();
//        System.out.println(tlogString);
//    }
//
//    @KafkaListener(topics = "info", containerFactory = "kafkaListenerContainerFactory")
//    public void listenInfo(ConsumerRecord consumerRecord) {
//        this.addToMessageMapList(consumerRecord, "info");
//    }

//    @KafkaListener( id = "grouplistener",
//            topicPartitions = {
//                    @TopicPartition(
//                            topic = "test-reply", partitionOffsets = @PartitionOffset(partition = "0", initialOffset = "0")
//                    )
//            })

    @KafkaListener(topics = "test-reply", containerFactory = "kafkaListenerContainerFactory")
    public void listenTestReply(ConsumerRecord consumerRecord) {
        Tmessage tmessage = (Tmessage) SpecificData.get().deepCopy(Tmessage.SCHEMA$, consumerRecord.value());
        TmessageKey tmessageKey = (TmessageKey) SpecificData.get().deepCopy(TmessageKey.SCHEMA$, consumerRecord.key());
//        tmessageKey.setTactionName(tmessage.getTaction());
        // if(tmessage.getTdesignation().equals("FE")) {
        tmessageKey.setId(777);
        this.messageMapList.getInstance();
        messageMapList.add(tmessageKey, tmessage);
        //  }
        logger.info("Receiving message from Kafka :: Topic " + "test-reply" + " TransactionMessage: :: {}", tmessage.toString() + " with Key: " + tmessageKey.toString());


    }


    private void addToMessageMapList(ConsumerRecord consumerRecord, String topic){
        Tmessage tmessage = (Tmessage) SpecificData.get().deepCopy(Tmessage.SCHEMA$, consumerRecord.value());
        TmessageKey tmessageKey = (TmessageKey) SpecificData.get().deepCopy(TmessageKey.SCHEMA$, consumerRecord.key());
//        tmessageKey.setTactionName(tmessage.getTaction());
       // if(tmessage.getTdesignation().equals("FE")) {
//            tmessageKey.setId(777);
//            this.messageMapList.getInstance();
//            messageMapList.add(tmessageKey, tmessage);
      //  }
            logger.info("Receiving message from Kafka :: Topic " + topic + " TransactionMessage: :: {}", tmessage.toString() + " with Key: " + tmessageKey.toString());

    }

}


//public class AvroSpecificDeserializer {
//
//    private static Properties kafkaProps = new Properties();
//
//    static {
//        kafkaProps.put(ConsumerConfig.GROUP_ID_CONFIG, "CustomerCountryGroup1");
//        kafkaProps.put("zookeeper.connect", "localhost:2181");
//        kafkaProps.put("schema.registry.url", "http://localhost:8081");
//    }
//
//    public static void infiniteConsumer() throws IOException {
//        VerifiableProperties properties = new VerifiableProperties(kafkaProps);
//        KafkaAvroDecoder keyDecoder = new KafkaAvroDecoder(properties);
//        KafkaAvroDecoder valueDecoder = new KafkaAvroDecoder(properties);
//
//        Map<String, Integer> topicCountMap = new HashMap<>();
//        topicCountMap.put("NewTopic", 1);
//
//        ConsumerConnector consumer = createJavaConsumerConnector(new kafka.consumer.ConsumerConfig(kafkaProps));
//        Map<String, List<KafkaStream<Object, Object>>> consumerMap = consumer.createMessageStreams(topicCountMap, keyDecoder, valueDecoder);
//
//        KafkaStream stream = consumerMap.get("NewTopic").get(0);
//        ConsumerIterator it = stream.iterator();
//
//        System.out.println("???????????????????????????????????????????????? ");
//        while (it.hasNext()) {
//            System.out.println(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ");
//            MessageAndMetadata messageAndMetadata = it.next();
//            String key = (String) messageAndMetadata.key();
//            GenericRecord record = (GenericRecord) messageAndMetadata.message();
//            Customer customer = (Customer) SpecificData.get().deepCopy(Customer.SCHEMA$, record);
//            System.out.println("Key: " + key);
//            System.out.println("Value: " + customer);
//        }
//
//    }
