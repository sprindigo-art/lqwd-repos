package com.lqwd.consumer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit4.SpringRunner;

@RunWith(SpringRunner.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AvroConsumerTest {

//    @Autowired
//    AvroProducer avroProducer;
//    @Autowired
//    AvroConsumer avroConsumer;

    @BeforeEach
    void setUp() {
    }

    @AfterEach
    void tearDown() {
    }

//    @Test
//    void consumeAllMessages() {
//        Random rn = new Random();
//
//        int id = rn.nextInt();
//        Tmessage tmessage = new Tmessage(id, "test send()",
//                "This is test from DB-microservice AvroProducer send(" + Integer.toString(id) + ")",
//                "noneTest",
//                "db-consumer");
//
//        TmessageKey tmessageKey = new TmessageKey(id, "dbmicroservice");
//
//        Message<Tmessage> mTmessage = MessageBuilder.withPayload(tmessage).build();
//        boolean sendResult = avroProducer.send(tmessage, tmessageKey);
//        Tmessage tmessageConsumer = avroConsumer.consumeAllMessages(mTmessage);
//
//        assertEquals(tmessageConsumer, tmessage);
//    }
}