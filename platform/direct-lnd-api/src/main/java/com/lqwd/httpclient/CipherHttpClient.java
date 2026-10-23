package com.lqwd.httpclient;

import com.google.gson.Gson;
import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.HashMap;

@Component
@RequiredArgsConstructor
public class CipherHttpClient {

    private final static Logger logger = LoggerFactory.getLogger(CipherHttpClient.class);

    private final AppProperties properties;


    public String sendRequest(String path, HashMap<String, Object> data, String token) throws UnsupportedEncodingException {

        logger.info("Debugging cipher url : "+ properties.getCipher_url());
        logger.info("Debugging cipher port : "+ properties.getCipher_port());
        logger.info("Debugging cipher token : "+ token);
        String commandUrl = String.format("http://%s:%s/api/v1/%s",
                properties.getCipher_url(), properties.getCipher_port(), path);

        HttpPost postRequest = new HttpPost(commandUrl);
        postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        postRequest.setHeader(HttpHeaders.CONTENT_TYPE, "application/json");
        postRequest.setHeader(HttpHeaders.ACCEPT, "application/json");
        String json = new Gson().toJson(data);
        postRequest.setEntity(new StringEntity(json));
        CloseableHttpClient httpClient = HttpClients.createDefault();

        try (CloseableHttpResponse httpResponse = httpClient.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode != 200)
                logger.info("A http error occurred on post request to cipher service, status: {}", content);

            return content;
        } catch (IOException e) {
            logger.info("An exception occurred when sending post request: {}",e.getMessage());

        }
        throw new BadRequestException(400, "An error occurred when communicating with cipher service");
    }
}
