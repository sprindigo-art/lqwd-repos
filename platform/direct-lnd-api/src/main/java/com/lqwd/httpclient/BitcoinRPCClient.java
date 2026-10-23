package com.lqwd.httpclient;

import com.lqwd.model.BTCResponse;
import org.apache.http.HttpEntity;
import org.apache.http.HttpResponse;
import org.apache.http.auth.AuthScope;
import org.apache.http.auth.UsernamePasswordCredentials;
import org.apache.http.client.CredentialsProvider;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.BasicCredentialsProvider;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.util.EntityUtils;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.UUID;

public class BitcoinRPCClient {


    private static final String COMMAND_GET_INFO = "gettransaction";
    private static final String COMMAND_ESTIMATE_FEE = "estimatesmartfee";

    private Logger logger = LoggerFactory.getLogger(BitcoinRPCClient.class);

    private String bitcoindHost;
    private String bitcoindUsername;
    private String bitcoindPassword;
    private int bitcoindPort;
    private CloseableHttpClient httpclient;
    private String bitcoindURL;

    public BitcoinRPCClient(String host, int port, String username, String password) {

        this.bitcoindHost = host;
        this.bitcoindPort = port;
        this.bitcoindUsername = username;
        this.bitcoindPassword = password;
        this.bitcoindURL = String.format("http://%s:%s", host, port);

    }

    public void initializeHttpClient() {

        CredentialsProvider provider = new BasicCredentialsProvider();
        provider.setCredentials(
                new AuthScope(this.bitcoindHost, this.bitcoindPort),
                new UsernamePasswordCredentials(this.bitcoindUsername, this.bitcoindPassword)
        );

        this.httpclient = HttpClientBuilder.create()
                .setDefaultCredentialsProvider(provider)
                .build();
    }

    private BTCResponse invokeRPC(String id, String method, JSONArray jsonArray) {


        JSONObject json = new JSONObject();
        json.put("id", id);
        json.put("method", method);

        if (null != jsonArray) {
            json.put("params", jsonArray);
        }


        try {

            StringEntity myEntity = new StringEntity(json.toString());

            HttpPost httppost = new HttpPost(this.bitcoindURL);
            httppost.setEntity(myEntity);

            HttpResponse response = this.httpclient.execute(httppost);

            if (response.getStatusLine().getStatusCode() != 200)
                return BTCResponse.builder()
                        .status(response.getStatusLine().getStatusCode())
                        .message(response.getStatusLine().getReasonPhrase()).build();

            HttpEntity entity = response.getEntity();


            return BTCResponse.builder()
                    .status(response.getStatusLine().getStatusCode())
                    .message(response.getStatusLine().getReasonPhrase())
                    .response(EntityUtils.toString(entity)).build();

        } catch (IOException e) {

            logger.error("An exception occurred when calling btc node: {}", e.getMessage());

        }

        return BTCResponse.builder()
                .status(500)
                .message("An exception occurred when communicating with node").build();
    }

    public void close(){

        try {
            httpclient.close();
        } catch (IOException e) {
            logger.error("An exception occurred when closing client: {}", e.getMessage());
        }

    }

    public BTCResponse getTransaction(String trxHash) {
        JSONArray array = new JSONArray();
        array.put(trxHash);
        return invokeRPC(UUID.randomUUID().toString(), COMMAND_GET_INFO, array);

    }

    public BTCResponse estimateFee(int nBlocks) {
        JSONArray array = new JSONArray();
        array.put(nBlocks);
        return invokeRPC(UUID.randomUUID().toString(), COMMAND_ESTIMATE_FEE, array);

    }

}
