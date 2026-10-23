package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.config.AppProperties;
import com.lqwd.httpclient.BitcoinRPCClient;
import com.lqwd.model.BTCResponse;
import org.junit.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.junit.jupiter.api.Assertions.assertTrue;

public class BTCClientTest extends AbstractTest {

    @Autowired
    private BitcoinRPCClient regTestClient;

    @Autowired
    private AppProperties properties;


    @Test
    public void testGetInfo() {

        regTestClient.initializeHttpClient();

        BTCResponse info = regTestClient.estimateFee(
                6);

        regTestClient.close();

        assertTrue(500 == info.getStatus());



    }

    @Test
    public void testGetBtcCred() {

        AppProperties.Credential credential = properties.getBtcd()
                .get("testnet");

        assertTrue("127.0.0.1".equals( credential.getHost()));


    }



}