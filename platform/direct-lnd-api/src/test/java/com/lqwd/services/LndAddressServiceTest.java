package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.LndAddress;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.LndAddressService;
import org.junit.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

import java.util.Optional;

import static org.junit.Assert.assertEquals;


public class LndAddressServiceTest extends AbstractTest {

    @Autowired
    private LndAddressService lndAddressService;

    @MockBean
    HttpClientToken httpClientToken;
    @MockBean
    LndHttpClient lndHttpClient;


    @Test
    public void createLndAddressFailedTest()  {

        MainResponse mainResponse = new MainResponse();
        mainResponse.setStatus(500);

        Mockito.when(httpClientToken.lndNodeInfo("testKey", "lnd4",
                "/lndnode/getinfo",
                "LndNodeInfo")).thenReturn(mainResponse);

        ApiResponse<LndAddress> response = lndAddressService.createNodeAddressForUser("lnd4",
                null,"testUserId","testKey", "tlnd4@lqwd.money");

        assertEquals(401,response.getStatus());
        assertEquals(false,response.isSuccess());

    }

    @Test
    public void createLndAddressSuccessTest() throws Exception {

        MainResponse mainResponse = new MainResponse();
        mainResponse.setStatus(200);
        mainResponse.setObject("{\"namespace\":\"lqwd-lnd\",\"isNonCustodial\":false," +
                " \"privateAddress\": \"lnd4.lqwd-lnd\"}");

        Mockito.when(httpClientToken.lndNodeInfo("testKey", "lnd4",
                "/lndnode/getinfo",
                "LndNodeInfo")).thenReturn(mainResponse);

        Mockito.when(lndHttpClient.getRequestToLndPod("v1/newaddress", "lnd4.lqwd-lnd",
                Optional.empty(),"lnd4",null)).thenReturn(LNDResponse.builder()
                .response("{\"address\":\"test-lnd-address\"}")
                .status(200).build());


        ApiResponse<LndAddress> response = lndAddressService.createNodeAddressForUser("lnd4",
                null,"testUserId","testKey", "tlnd4@lqwd.money");

        assertEquals(200,response.getStatus());
        assertEquals(true,response.isSuccess());

    }


}