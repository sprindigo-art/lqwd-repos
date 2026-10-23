package com.lqwd.controller;

import com.lqwd.thread.TmessagesList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.web.server.LocalServerPort;
import org.springframework.cloud.stream.messaging.Processor;
import org.springframework.cloud.stream.test.binder.MessageCollector;
import org.springframework.test.context.junit4.SpringRunner;

@RunWith(SpringRunner.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LndControllerTest {

    @Autowired
    private TmessagesList tmessagesList;

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

//    @Autowired
//    AvroProducer avroProducer;
//
//    @Autowired
//    private Processor processor;
//
//    @Autowired
//    private MessageCollector messageCollector;


    @BeforeEach
    void setUp() {
    }

    @AfterEach
    void tearDown() {
    }



//    @Test
//    void getInfo() throws Exception {
//
//        String token = "50aebe9e-db4e-4aa5-864c-490a438e69a2";
//        HttpHeaders headers = new HttpHeaders();
//        headers.set(org.apache.http.HttpHeaders.AUTHORIZATION, "Bearer " + token );
//        headers.set(org.apache.http.HttpHeaders.ACCEPT, "application/json");
//
//        HttpEntity<String> entity = new HttpEntity<>("body", headers);
//
//        ResponseEntity<String> response = restTemplate.exchange(
//                new URL("http://localhost:" + port + "/lnd/info").toString(), HttpMethod.POST, entity, String.class);
//        assertEquals("Tmessage successfully sent to Kafka", response.getBody());
//
//    }


//    @Test
//    void testSendRecieve() throws Exception {
//        Random rn = new Random();
//
//        int id = rn.nextInt();
//        Tmessage tmessage = new Tmessage(id, "test send()",
//                "This is test from Ldn advanced process send(" + Integer.toString(id) + ")",
//                "noneTest",
//                "lndadvancedprocess");
//
//        TmessageKey tmessageKey = new TmessageKey(id, "dbmicroservice");
//        boolean sendResult = avroProducer.send(tmessage, tmessageKey);
//
//
//        Message<Tmessage> received = (Message<Tmessage>) messageCollector.forChannel(processor.output()).poll();
//
//        assertEquals(received.getPayload(), tmessage);
//    }
}