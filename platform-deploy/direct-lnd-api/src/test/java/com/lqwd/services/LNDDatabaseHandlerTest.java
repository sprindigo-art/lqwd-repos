package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.service.LNDDatabaseHandler;
import org.junit.Test;
import org.springframework.beans.factory.annotation.Autowired;

public class LNDDatabaseHandlerTest extends AbstractTest {


    @Autowired
    LNDDatabaseHandler handler;



    @Test
    public void deleteDBTest() {

        handler.deleteLNDDatabase("slnd-32729");

    }





}