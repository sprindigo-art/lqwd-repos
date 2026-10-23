package com.lqwd.httpclient;

import com.google.gson.Gson;
import com.lqwd.model.request.UserSetting;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.HashMap;

@Service
public class HttpClientUtility {

    @Value("${app.auth_post_url}")
    private String authPostUrl;

    @Value("${app.auth_post_port}")
    private String authPostUrlPort;

    @Value("${app.auth_user_name}")
    private String authUserName;

    @Value("${app.auth_password}")
    private String authPassword;

    private int numberOfConnectionRepeat =5;

    private HttpPost getHttpPost(String action){
        HttpPost postRequest = new HttpPost("http://" + this.authPostUrl + ":"
                + this.authPostUrlPort + action);

        String encoding = java.util.Base64.getEncoder()
                .encodeToString((this.authUserName + ":"
                        + this.authPassword).getBytes());


        postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Basic " + encoding);
        return postRequest;
    }

    public HttpPost getNewHttpPost(String action, HashMap<String, String> parts) {


        HttpPost postRequest = getHttpPost(action);

        MultipartEntityBuilder multipartEntityBuilder = MultipartEntityBuilder
                .create()
                .addPart("client_id", new StringBody(this.authUserName, ContentType.MULTIPART_FORM_DATA));

        parts.forEach((k, v)->{
            if(v != null) {
                multipartEntityBuilder.addPart(k, new StringBody(v, ContentType.MULTIPART_FORM_DATA));
            }
        });


        HttpEntity entity = multipartEntityBuilder.build();

        postRequest.setEntity(entity);

        return postRequest;
    }

    public HttpPost getNewHttpPost(String action , UserSetting userSetting) throws UnsupportedEncodingException {
        HttpPost postRequest = getHttpPost(action);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/json");

        userSetting.setServiceName(this.authUserName);

        Gson gson = new Gson();

        StringEntity postingString = new StringEntity(gson.toJson(userSetting));//gson.tojson() converts your pojo to json
        postRequest.setEntity(postingString);

        return postRequest;
    }


    public MainResponse httpConnection(HttpPost postRequest, String className, Logger logger){
        boolean result = false;
        String content ;
        CloseableHttpClient client = HttpClientBuilder.create().build();

        Boolean connectionTriger = true;
        MainResponse mainResponse = new MainResponse();
        int connectionCount = 0;

        while (connectionTriger) {
            connectionCount++;

            try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
                content = EntityUtils.toString(httpResponse.getEntity());

                int statusCode = httpResponse.getStatusLine().getStatusCode();
                if (statusCode == 200) {
                    mainResponse.setStatus(200);
                    mainResponse.setClass_name(className);
                    mainResponse.setObject(content);
                    connectionTriger = false;
                } else {
                    mainResponse.setStatus(statusCode);
                    mainResponse.setError(content);
                    mainResponse.setClass_name(className);
                    logger.info("statusCode = " + statusCode);
                    logger.info("content = " + content);
                    connectionTriger = false;
                }
//                connectionTriger = false;
            } catch (IOException e) {
                // handle exception
                if (connectionCount > numberOfConnectionRepeat) {
                    logger.info("Connection Error : repeated time 5 ");
                    content = "{status:500; content:NO_CONTENT}";
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
                mainResponse.setStatus(500);
                mainResponse.setError(e.getMessage());
                mainResponse.setClass_name(className);
            }

        }
        return mainResponse;
    }

    public CheckTokenResponse httpCheckToken(HttpPost postRequest, Logger logger){
        CheckTokenResponse checkTokenResponse = new CheckTokenResponse();
        String content;
        CloseableHttpClient client = HttpClientBuilder.create().build();

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
                if (connectionCount > numberOfConnectionRepeat) {
                    logger.info("Connection Error : repeated time 5 ");
                    content = "{status:500; content:NO_CONTENT}";
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
