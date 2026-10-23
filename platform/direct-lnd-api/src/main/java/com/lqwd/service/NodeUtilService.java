package com.lqwd.service;

import com.lqwd.config.AppProperties;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.request.OpenChannelRequest;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.OpenChannelResponse;
import lombok.RequiredArgsConstructor;
import org.apache.commons.codec.DecoderException;
import org.apache.commons.codec.binary.Hex;
import org.apache.http.entity.ContentType;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class NodeUtilService {

    private final static Logger logger = LoggerFactory.getLogger(NodeUtilService.class);
    private final LndHttpClient lndHttpClient;
    private final AppProperties properties;


    public OpenChannelResponse openChannelToNode(OpenChannelRequest channelRequest) throws Exception {

        OpenChannelResponse channelResponse = new OpenChannelResponse();

        byte[] hexString;

        try {

            hexString = Hex.decodeHex(channelRequest.getPubKey());

        } catch (DecoderException e) {
            channelResponse.setError("Failed to decode pubkey");
            channelResponse.setSuccess(false);
            return channelResponse;
        }

        String pubKey = Base64.getEncoder().encodeToString(hexString);

        String paymentAmt = Integer.toString(channelRequest.getCapacity());

        Map<String, Object> data = new HashMap<>();

        data.put("node_pubkey", pubKey);
        data.put("node_pubkey_string", channelRequest.getPubKey());
        data.put("local_funding_amount", paymentAmt);
        data.put("private", channelRequest.isPrivateChannel());

        if (!StringUtils.isEmpty(channelRequest.getSatPerVByte())) {
            data.put("sat_per_vbyte", channelRequest.getSatPerVByte());
        }

        LNDResponse response = lndHttpClient.postRequestToLndPod("v1/channels",
                channelRequest.getNodeAddress(), ContentType.APPLICATION_JSON, Optional.of(data),
                channelRequest.getLndname(), channelRequest.getPassphrase());


        if (response.getStatus() != 200) {
            channelResponse.setError(response.getResponse());
            channelResponse.setSuccess(false);
            return channelResponse;
        }


        logger.info("res = {}", response.getResponse());

        JSONObject jsonObject = new JSONObject(response.getResponse());

        channelResponse.setFunding_txid_bytes(jsonObject.getString("funding_txid_bytes"));
        channelResponse.setOutput_index(jsonObject.getInt("output_index"));
        channelResponse.setSuccess(true);
        return channelResponse;


    }


    public boolean peerWithNode(String remotePubkey, String nodeName,
                                String nodeAddress, String remoteAddress, String passphrase) {


        Map<String, String> address = new HashMap<>();
        address.put("pubkey", remotePubkey);
        address.put("host", remoteAddress);

        Map<String, Object> data = new HashMap<>();
        data.put("perm", false);
        data.put("timeout", "5");
        data.put("addr", address);


        try {

            LNDResponse response = lndHttpClient.postRequestToLndPod("v1/peers", nodeAddress,
                    ContentType.APPLICATION_JSON, Optional.of(data), nodeName
                    , passphrase);

            return response.getStatus() == 200;

        } catch (Exception e) {
            logger.info("An error occurred when pairing with node: {}", e.getMessage());
        }

        return false;

    }

    public boolean isNodePeered(String remotePubkey, String nodeAddress, String nodeName, String password) {


        try {

            LNDResponse response = lndHttpClient.getRequestToLndPod("v1/peers", nodeAddress,
                    Optional.empty(), nodeName, password);

            logger.info("peers: {}", response);

            if (response.getStatus() != 200) {
                logger.info("LND peer response is not 200 : {} : {}",
                        response.getStatus(), response.getResponse());
                return false;
            }

            JSONObject jsonObject = new JSONObject(response.getResponse());
            JSONArray jsonArray = jsonObject.getJSONArray("peers");

            for (int i = 0; i < jsonArray.length(); i++) {
                if (jsonArray.getJSONObject(i).getString("pub_key").equals(remotePubkey)) {
                    return true;
                }
            }


        } catch (Exception e) {
            logger.info("An error occurred when get node peers: {}", e.getMessage());
        }

        return false;

    }


}
