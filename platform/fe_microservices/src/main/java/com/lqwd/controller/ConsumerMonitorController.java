package com.lqwd.controller;


import com.lqwd.httpclient.CheckTokenResponse;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.schema.*;
import com.lqwd.thread.BackEndMapList;
import com.lqwd.thread.MessageMapList;
import com.lqwd.thread.TmessagesList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;

import java.math.BigInteger;
import java.util.Set;

@RestController
public class ConsumerMonitorController {

    private static final Logger logger = LoggerFactory.getLogger(ConsumerMonitorController.class);

    @Autowired
    private TmessagesList tmessagesList;

    @Autowired
    private MessageMapList messageMapList;

    @Autowired
    private BackEndMapList backEndMapList;

    @Autowired
    private HttpClientToken httpClientToken;
    
    @GetMapping("/requests")
    public @ResponseBody
    String ajaxRequest(){
        String str = " no message ";
        tmessagesList.getInstance();
        if(tmessagesList.size() >0) {
            str="";
            for (Tmessage sm : tmessagesList.getInstance()) {
                str += sm.toString();
            }
            tmessagesList.cleanList();
        }
        return "{\"success\":"+str+"}";
    }

    @ResponseBody
    @PostMapping("/getdata")
    public ResponseEntity<MessageResponse> getData(@RequestHeader (name="Authorization") String token, HttpServletRequest request){

        backEndMapList.getInstance();
        Set<TmessageKey> keys = backEndMapList.getKeys();
        for (TmessageKey key: keys) {
            token = token.replace("Bearer ", "");
            CheckTokenResponse checkTokenResponse = httpClientToken.checkToken(token);
            String username = checkTokenResponse.getUser_name();


            if(backEndMapList.getUsername(key).equals(username) ){
                BackEndReply backEndReply = this.backEndMapList.getAndRemoveTmessage(key);
                TmessageResponse tmessageResponse = new TmessageResponse(backEndReply);
                TmessageKeyResponse tmessageKeyResponse = new TmessageKeyResponse(key.getId(),key.getTactionName().toString());
                MessageResponse resp = new MessageResponse(tmessageKeyResponse, tmessageResponse);
                logger.info("FrontEnd Message send: "+ resp.toString());

                return new ResponseEntity<>(resp, HttpStatus.OK);
            }
        }
        return new ResponseEntity<>(HttpStatus.NO_CONTENT);
    }
}
