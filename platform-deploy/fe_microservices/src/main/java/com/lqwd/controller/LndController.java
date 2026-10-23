package com.lqwd.controller;

import com.lqwd.httpclient.CheckTokenResponse;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.producer.KafkaProducerService;
import com.lqwd.schema.BackEndReply;
import com.lqwd.schema.FrontEndRequest;
import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageKey;
import org.apache.avro.util.Utf8;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigInteger;
import java.util.Random;

@RestController
@RequestMapping(value = "/lnd")
public class LndController {

    public static final Logger logger = LoggerFactory.getLogger(LndController.class);

    private String topic = "request";

    @Autowired
    private KafkaProducerService kafkaProducerService;

    @Autowired
    private HttpClientToken httpClientToken;

    private boolean generateAndSendMessage(String requestAction, String token, String lnd_name){
        Random random = new Random();
        int id = random.nextInt();

        token = token.replace("Bearer ", "");
        CheckTokenResponse checkTokenResponse = httpClientToken.checkToken(token);
        String username = checkTokenResponse.getUser_name();


        FrontEndRequest frontEndRequest = new FrontEndRequest();
        frontEndRequest.setId(id);
        frontEndRequest.setRequestedAction(requestAction);
        frontEndRequest.setDescription("get " + requestAction + " information");
        frontEndRequest.setUsername(username);
        frontEndRequest.setNodeId(lnd_name);
        frontEndRequest.setTimestamp(0L);

        TmessageKey tmessageKey = new TmessageKey(id, "lnd");

//        return initBackendSchema();

        boolean result = kafkaProducerService.sendMessage(tmessageKey, frontEndRequest, this.topic);

        logger.info("Result of send " + requestAction + " to Kafka: " + Boolean.toString(result));

        return result;
    }

    @ResponseBody
    @PostMapping(path = "/getinfo")
    public ResponseEntity<String> getInfo(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("getinfo", token, lnd_name)){
           return  ResponseEntity.ok("Getinfo request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send getinfo to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/peers")
    public ResponseEntity<String> getPeers(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("peers", token, lnd_name)){
            return  ResponseEntity.ok("Peers request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send Peers request to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/channels")
    public ResponseEntity<String> getChannel(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("channels", token, lnd_name)){
            return  ResponseEntity.ok("Channels request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send channels request to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/fees")
    public ResponseEntity<String> getFees(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("fees", token, lnd_name)){
            return  ResponseEntity.ok("Fees request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send fees request to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/getrecoveryinfo")
    public ResponseEntity<String> getGetrecoveryinfo(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {
        if(this.generateAndSendMessage("getrecoveryinfo", token, lnd_name)){
            return  ResponseEntity.ok("getrecoveryinfo request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send getrecoveryinfo request to Kafka.");
        }
    }


    @ResponseBody
    @PostMapping(path = "/graphinfo")
    public ResponseEntity<String> getGraphinfo(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("graphinfo", token, lnd_name)){
            return  ResponseEntity.ok("graphinfo request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send graphinfo request to Kafka.");
        }
    }


    @ResponseBody
    @PostMapping(path = "/listpermissions")
    public ResponseEntity<String> getListpermissions(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("listpermissions", token, lnd_name)){
            return  ResponseEntity.ok("listpermissions request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send listpermissions request to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/walletbalance")
    public ResponseEntity<String> getWalletbalance(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {



        if(this.generateAndSendMessage("walletbalance", token, lnd_name)){
            return  ResponseEntity.ok("walletbalance request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send walletbalance request to Kafka.");
        }
    }

    //new path for requesting channelbalance
    @ResponseBody
    @PostMapping(path = "/channelbalance")
    public ResponseEntity<String> getChannelbalance(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("channelbalance", token, lnd_name)){
            return  ResponseEntity.ok("channelbalance request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send channelbalance request to Kafka.");
        }
    }


    @ResponseBody
    @PostMapping(path = "/sendmessage")
    public ResponseEntity<String> sendMessage(FrontEndRequest frontEndRequest, int id)  {

        TmessageKey tmessageKey = new TmessageKey(id, "lnd");

        boolean result = kafkaProducerService.sendMessage(tmessageKey, frontEndRequest, this.topic);

        logger.info("Result of send Tmessage to Kafka: "+Boolean.toString(result));

        if(result){
            return  ResponseEntity.ok("Tmessage successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send Tmessage to Kafka.");
        }
    }


    @ResponseBody
    @PostMapping(path = "/channel/open")
    public ResponseEntity<String> channelOpen(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("channels", token, lnd_name)){
            return  ResponseEntity.ok("Channels request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send channels request to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/channel/status")
    public ResponseEntity<String> channelStatus(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("channels", token, lnd_name)){
            return  ResponseEntity.ok("Channels request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send channels request to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/channel/close")
    public ResponseEntity<String> channelClose(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("channels", token, lnd_name)){
            return  ResponseEntity.ok("Channels request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send channels request to Kafka.");
        }
    }

    @ResponseBody
    @PostMapping(path = "/generateschema")
    public ResponseEntity<String> generateschema(@RequestHeader (name="Authorization") String token, @RequestParam String lnd_name)  {

        if(this.generateAndSendMessage("getinfo", token, lnd_name)){
            return  ResponseEntity.ok("Getinfo request successfully sent to Kafka");
        } else{
            return ResponseEntity.ok("Problem send getinfo to Kafka.");
        }
    }

    private boolean generateAllSchemas(String requestAction, String token){
        Random random = new Random();
        int id = random.nextInt();

        token = token.replace("Bearer ", "");
        CheckTokenResponse checkTokenResponse = httpClientToken.checkToken(token);
        String username = checkTokenResponse.getUser_name();

        BackEndReply backEndReply = new BackEndReply();
        backEndReply.setReplyId(id);
        backEndReply.setUsername(username);
        backEndReply.setDescription("get " + requestAction + " information");
        backEndReply.setReplyMessage("get " + requestAction + " information");
        backEndReply.setRequestedAction(requestAction);
        backEndReply.setReplyNodeId("node");

//        FrontEndRequest frontEndRequest = new FrontEndRequest();
//        frontEndRequest.setId(id);
//        frontEndRequest.setRequestedAction(requestAction);
//        frontEndRequest.setDescription("get " + requestAction + " information");
//        frontEndRequest.setUsername(username);
//        frontEndRequest.setNodeId("node_id");
//        frontEndRequest.setTimestamp(0L);

        TmessageKey tmessageKey = new TmessageKey(id, "lnd");


        boolean result = kafkaProducerService.sendMessageB(tmessageKey, backEndReply, this.topic);

        logger.info("Result of send " + requestAction + " to Kafka: " + Boolean.toString(result));

        return result;
    }

    private boolean initBackendSchema(){

        TmessageKey tmessageKey = new TmessageKey(0, "init-schema");

        //Backend Schema Reply
        BackEndReply backEndReply = new BackEndReply();
        backEndReply.setReplyId(0);
        backEndReply.setUsername("initschema");
        backEndReply.setDescription("Init BackEndReply Schema");
        backEndReply.setReplyMessage("Init BackEndReply Schema");
        backEndReply.setRequestedAction("init-schema");
        backEndReply.setReplyNodeId("node");
        backEndReply.setTimestamp(0L);
        backEndReply.setError(false);

        boolean result = kafkaProducerService.sendMessageB(tmessageKey, backEndReply, "reply");
        logger.info("Result of send Backend to Kafka: " + Boolean.toString(result));
        return result;
    }
}
