package com.lqwd;

import com.lqwd.producer.KafkaProducerService;
import com.lqwd.schema.BackEndReply;
import com.lqwd.schema.FrontEndRequest;
import com.lqwd.schema.TmessageKey;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.ListTopicsOptions;
import org.apache.kafka.clients.admin.ListTopicsResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.kafka.core.KafkaAdmin;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.kafka.support.SendResult;
import org.springframework.messaging.Message;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Component;
import org.springframework.util.concurrent.ListenableFuture;
import org.springframework.util.concurrent.ListenableFutureCallback;

import javax.annotation.PostConstruct;


@Component
public class InitKafkaSchemas {

    public static final Logger logger = LoggerFactory.getLogger(InitKafkaSchemas.class);

    private KafkaTemplate<String, FrontEndRequest> kafkaTemplate;
    private KafkaTemplate<String, BackEndReply> kafkaTemplateB;

    @Autowired
    InitKafkaSchemas(KafkaTemplate<String, FrontEndRequest> kafkaTemplate,
                     KafkaTemplate<String, BackEndReply> kafkaTemplateB
                     ) {
        this.kafkaTemplate = kafkaTemplate;
        this.kafkaTemplateB = kafkaTemplateB;
    }


    @PostConstruct
    public void init() throws Exception {
        logger.info("---------------------init called .........................");



        BackEndReply backEndReply = new BackEndReply();
        backEndReply.setReplyId(0);
        backEndReply.setUsername("init-be-reply");
        backEndReply.setDescription("Ensuring BE Reply Schema Exists");
        backEndReply.setReplyMessage("Ensuring BE Reply Schema Exists");
        backEndReply.setRequestedAction("init");
        backEndReply.setReplyNodeId("init-node");
        backEndReply.setId(0);
        backEndReply.setTimestamp(System.currentTimeMillis());
        backEndReply.setError(false);
        logger.info(backEndReply.toString());



//        FrontEndRequest frontEndRequest = new FrontEndRequest();
//        frontEndRequest.setId(id);
//        frontEndRequest.setRequestedAction(requestAction);
//        frontEndRequest.setDescription("get " + requestAction + " information");
//        frontEndRequest.setUsername(username);
//        frontEndRequest.setNodeId("node_id");
//        frontEndRequest.setTimestamp(0L);


        TmessageKey tmessageKey = new TmessageKey(0, "init");
        Message<BackEndReply> message = MessageBuilder
                .withPayload(backEndReply)
                .setHeader(KafkaHeaders.TOPIC, "reply")
                .setHeader(KafkaHeaders.MESSAGE_KEY, tmessageKey)
                .setHeader(KafkaHeaders.PARTITION_ID, 0)
                .build();
        kafkaTemplateB.send(message);
    }
}