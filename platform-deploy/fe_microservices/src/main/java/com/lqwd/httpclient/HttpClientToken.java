package com.lqwd.httpclient;


import org.apache.http.*;

import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;

import org.apache.http.entity.ContentType;

import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;

import org.apache.http.impl.client.*;

import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;


import java.io.IOException;


@Component
public class HttpClientToken {



    private String appAuthPostUrl;


    private String appAuthPassword;


    private String appAuthUserName;


    private String appAuthPostPort;

    private int numberOfConnectionRepeat =5;

    private final static Logger logger = LoggerFactory.getLogger(HttpClientToken.class);

    public void initHttpClientToken(String appAuthPostUrl, String appAuthPostPort, String appAuthUserName, String appAuthPassword) {
        this.appAuthPostUrl = appAuthPostUrl;
        this.appAuthPostPort = appAuthPostPort;
        this.appAuthUserName = appAuthUserName;
        this.appAuthPassword = appAuthPassword;

    }


    public CheckTokenResponse checkToken(String token) {
        CheckTokenResponse checkTokenResponse = new CheckTokenResponse();
        String content ;
        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + "/oauth/check_token");

        String encoding = java.util.Base64.getEncoder()
                .encodeToString((this.appAuthUserName + ":"
                        + this.appAuthPassword).getBytes());


        postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Basic " + encoding);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");


        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("token", new StringBody(token, ContentType.MULTIPART_FORM_DATA))
                .addPart("client_id", new StringBody(this.appAuthUserName, ContentType.MULTIPART_FORM_DATA)).build();
        postRequest.setEntity(entity);

        Boolean connectionTriger = true;
        int connectionCount = 0;

        while (connectionTriger) {
            connectionCount++;

            try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
                content = EntityUtils.toString(httpResponse.getEntity());

                int statusCode = httpResponse.getStatusLine().getStatusCode();
                if (statusCode == 200) {
                    checkTokenResponse = checkTokenResponse.mapContent(content);
                } else {
                    logger.info("statusCode = " + statusCode);
                    logger.info("content = " + content);
                }
                connectionTriger = false;
            } catch (IOException e) {
                // handle exception
                if(connectionCount>numberOfConnectionRepeat){
                    logger.info("Connection Error : repeated time 5 ");
                    content="{status:500; content:NO_CONTENT}";
                    connectionTriger = false;
                } else {
                    try {
                        wait(5000);
                    } catch (InterruptedException interruptedException) {
                        interruptedException.printStackTrace();
                    }
                }
                logger.info(e.getMessage());
                e.printStackTrace();
            }
        }
        return checkTokenResponse;
    }

}
