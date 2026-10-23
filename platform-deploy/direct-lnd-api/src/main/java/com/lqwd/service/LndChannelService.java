package com.lqwd.service;

import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.response.LNDResponse;
import lombok.RequiredArgsConstructor;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
@RequiredArgsConstructor
public class LndChannelService {

    private static final Logger logger = LoggerFactory.getLogger(LndChannelService.class);
    private final LndHttpClient lndHttpClient;

    public void closeAllLndChannels(String lndNodeName, String nodeAddress, String password){

        try {
            logger.info("Lnd Channels service line 24    channels : ");
            LNDResponse response = lndHttpClient.getRequestToLndPod("v1/channels?active_only=true", nodeAddress,
                    Optional.empty(),lndNodeName, password);

            logger.info("Lnd Channel service line 28  response: " + response);
            if(response == null)
                return;
            logger.info("Lnd Channel service line 31  response: " + response.toString());
            if(response.getStatus() != 200)
                return;
            logger.info("Lnd Channel service line 34  response: " + response.toString());

            JSONObject responseObj = new JSONObject(response.getResponse());
            JSONArray jsonArray = responseObj.getJSONArray("channels");

            for(int i = 0; i < jsonArray.length(); i++){

                JSONObject object = jsonArray.getJSONObject(i);
                String channelPoint = object.getString("channel_point");
                String[] points = channelPoint.split(":");
                closeChannel(lndNodeName,nodeAddress,points[0],points[1],password);
            }

        } catch (Exception e) {
            logger.info("Lnd Channels service line 48  after close channels : " + e.getMessage());
            logger.error("An error occurred when retrieving channels", e.getCause());
        }

    }

    public void closeChannel(String lndNodeName, String nodeAddress,String txId, String outputIndex, String password){
        try {
            lndHttpClient.deleteRequestToLndPod(String.format("v1/channels/%s/%s?force=true",
                    txId,outputIndex), nodeAddress, Optional.empty(),lndNodeName, password);
        } catch (Exception e) {
            logger.error("An error occurred when closing channel", e.getCause());
        }
    }


}
