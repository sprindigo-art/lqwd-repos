package com.lqwd.controller;

import com.lqwd.schema.BackEndReply;
import com.lqwd.schema.FrontEndRequest;
import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageResponse;
import com.lqwd.thread.TmessagesList;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
public class ConsumerController {

    @Autowired
    private TmessagesList tmessagesList;

    @ResponseBody
    @PostMapping("/results")
    public ResponseEntity<TmessageResponse> getMessages(){

       // BackEndReply backEndReply = new BackEndReply();

        Tmessage tmessage = new Tmessage();
        tmessage.setDescription("No new messages");
        tmessagesList.getInstance();
        if(tmessagesList.size() >0) {

            tmessage = tmessagesList.getFirst();

        }

        return new ResponseEntity<TmessageResponse>(new TmessageResponse(tmessage), HttpStatus.OK);

    }



}
