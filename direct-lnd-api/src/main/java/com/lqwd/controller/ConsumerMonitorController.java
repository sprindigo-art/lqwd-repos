package com.lqwd.controller;


import com.lqwd.schema.*;
import com.lqwd.thread.MessageMapList;
import com.lqwd.thread.TmessagesList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;

import java.util.Set;

@RestController
public class ConsumerMonitorController {

    private static final Logger logger = LoggerFactory.getLogger(ConsumerMonitorController.class);

    @Autowired
    private TmessagesList tmessagesList;

    @Autowired
    private MessageMapList messageMapList;
    
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
    public ResponseEntity<MessageResponse> getData(HttpServletRequest request, @RequestParam int userid){
        messageMapList.getInstance();
        Set<TmessageKey> keys = messageMapList.getKeys();
        for (TmessageKey key: keys) {
            int a = key.getId();
            if(a == userid){
                Tmessage tmessage = this.messageMapList.getAndRemoveTmessage(key);
                TmessageResponse tmessageResponse = new TmessageResponse(tmessage);
                TmessageKeyResponse tmessageKeyResponse = new TmessageKeyResponse(777,key.getTactionName().toString());
                MessageResponse resp = new MessageResponse(tmessageKeyResponse, tmessageResponse);
                logger.info("FrontEnd Message send: "+ resp.toString());

                return new ResponseEntity<>(resp, HttpStatus.OK);
            }
        }
        return new ResponseEntity<>(HttpStatus.NO_CONTENT);
    }
}
