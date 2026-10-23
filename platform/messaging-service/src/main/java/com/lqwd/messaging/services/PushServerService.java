package com.lqwd.messaging.services;

import com.google.gson.Gson;
import com.lqwd.messaging.interfaces.CacheStore;
import com.lqwd.messaging.schemas.PushNotification;
import lombok.RequiredArgsConstructor;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;

@Service
@RequiredArgsConstructor
public class PushServerService {

    private final CacheStore cacheStore;
    private final Logger logger = LoggerFactory.getLogger(PushServerService.class);


    public void sendPush(PushNotification notification) {

        //retrieve push server for user
        String connectedPushServerInstance = cacheStore.retrieve(notification.getUserId());

        logger.info("Retrieving push instance : {}", connectedPushServerInstance);

        if( connectedPushServerInstance == null)
            return;

        logger.info("Retrieved, sending push to, {} from server: {}", notification.getUserId(), connectedPushServerInstance);

        CloseableHttpClient client = HttpClients.createDefault();
        HttpPost httpPost = new HttpPost(String.format("http://%s:7008/push",
                connectedPushServerInstance));

        httpPost.setHeader("X-CUSTOMER_ID", notification.getUserId());
        httpPost.setHeader("Accept", "application/json");
        httpPost.setHeader("Content-type", "application/json");

        String json = new Gson().toJson(notification.getData());

        try {

            StringEntity entity = new StringEntity(json);
            httpPost.setEntity(entity);
            CloseableHttpResponse response = client.execute(httpPost);

            logger.info("Push response status is : {}", response.getStatusLine().getStatusCode());

        } catch (IOException e) {
            logger.error("An error occurred when sending push: {}", e.getMessage());
        }


    }
}
