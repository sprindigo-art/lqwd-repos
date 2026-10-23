package com.lqwd.controller;

import org.springframework.beans.factory.annotation.Autowired;

import java.util.Date;

public class ConsumerRunnableThread extends Thread{

//    @Autowired
//    private AvroConsumer avroConsumer;
//
//    ConsumerRunnableThread(){
//        super("Start consumer thread for lisening kafka");
//        System.out.println("Consumer started at : " + this);
//        start();
//    }
//
//    public void run()
//    {
//        boolean getmessage = false;
//        Date d1 = new Date();
//        long checkingTime = 10;
//
//        while (getmessage) {
//
//            avroConsumer = new AvroConsumer();
//
//            Date d2 = new Date();
//            long seconds = (d2.getTime()-d1.getTime())/1000;
//            if(seconds >= checkingTime ){
//                getmessage = false;
//            }
//        }
//        System.out.println("My thread run is over" );
//    }
//

}
