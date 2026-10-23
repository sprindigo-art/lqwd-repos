//package com.lqwd.config;
//
//import com.twilio.Twilio;
//import org.springframework.beans.factory.annotation.Value;
//import org.springframework.cloud.context.config.annotation.RefreshScope;
//import org.springframework.context.annotation.Configuration;
//
//import javax.annotation.PostConstruct;
//
//@Configuration
//@RefreshScope
//public class TwilioConfig {
//
//    @Value("${twilio.account.sid}")
//    private String twilioAccountSID;
//    @Value("${twilio.account.auth-token}")
//    private String twilioAuthToken;
//
//    @PostConstruct
//    public void initialize(){
//        Twilio.init(twilioAccountSID,twilioAuthToken);
//    }
//}
