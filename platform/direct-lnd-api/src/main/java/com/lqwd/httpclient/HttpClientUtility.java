package com.lqwd.httpclient;

import com.google.gson.Gson;
import com.lqwd.config.AppProperties;
import com.lqwd.model.request.UserSetting;
import com.lqwd.model.response.CheckTokenResponse;
import com.lqwd.model.response.MainResponse;
import lombok.RequiredArgsConstructor;
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
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.HashMap;

@Service
@RequiredArgsConstructor
public class HttpClientUtility {

    private final AppProperties properties;
    private final static Logger logger = LoggerFactory.getLogger(HttpClientUtility.class);

    public HttpPost getHttpPost(String action, String clientId, String clientSecret) {

        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + action);

        String encoding = java.util.Base64.getEncoder()
                .encodeToString((clientId + ":"
                        + clientSecret).getBytes());


        postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Basic " + encoding);
        return postRequest;
    }


    public HttpPost getNewHttpPost(String action, HashMap<String, String> parts) {

        HttpPost postRequest = getHttpPost(action, properties.getAuth_user_name(), this.properties.getAuth_password());

        MultipartEntityBuilder multipartEntityBuilder = MultipartEntityBuilder
                .create()
                .addPart("client_id", new StringBody(properties.getAuth_user_name(),
                        ContentType.MULTIPART_FORM_DATA));

        parts.forEach((k, v) -> {
            if (v != null) {
                multipartEntityBuilder.addPart(k, new StringBody(v, ContentType.MULTIPART_FORM_DATA));
            }
        });


        HttpEntity entity = multipartEntityBuilder.build();

        postRequest.setEntity(entity);

        return postRequest;
    }


    public HttpPost getNewHttpPostJSON(String action, HashMap<String, String> parts) throws UnsupportedEncodingException {

        HttpPost postRequest = getHttpPost(action, properties.getAuth_user_name(),
                properties.getAuth_password());

        Gson gson = new Gson();

        StringEntity postingString = new StringEntity(gson.toJson(parts));//gson.tojson() converts your pojo to json

        logger.info("this is from 84 in HttpClientUtility " + parts.toString() );

        postRequest.setEntity(postingString);

        logger.info(" line 89 " + postRequest.getEntity());

        return postRequest;
    }


    public HttpPost getNewHttpPost(String action, UserSetting userSetting) throws UnsupportedEncodingException {

        HttpPost postRequest = getHttpPost(action, properties.getAuth_user_name(),
                properties.getAuth_password());

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/json");

        userSetting.setServiceName(properties.getAuth_user_name());

        Gson gson = new Gson();

        StringEntity postingString = new StringEntity(gson.toJson(userSetting));//gson.tojson() converts your pojo to json
        postRequest.setEntity(postingString);

        return postRequest;
    }


    public MainResponse httpConnection(HttpPost postRequest, String className, Logger logger) {
        String content;
        CloseableHttpClient client = HttpClientBuilder.create().build();

        MainResponse mainResponse = new MainResponse();


        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setStatus(200);
                mainResponse.setClass_name(className);
                mainResponse.setObject(content);
            } else {
                mainResponse.setStatus(statusCode);
                mainResponse.setError(content);
                mainResponse.setClass_name(className);
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }

        } catch (IOException e) {
            logger.info("Connection Error : repeated time 5 : {}", e.getMessage());

            logger.info(e.getMessage());
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            mainResponse.setClass_name(className);
        }


        return mainResponse;
    }

    public CheckTokenResponse httpCheckToken(HttpPost postRequest, Logger logger) {
        CheckTokenResponse checkTokenResponse = new CheckTokenResponse();
        String content;
        CloseableHttpClient client = HttpClientBuilder.create().build();


        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                checkTokenResponse = checkTokenResponse.mapContent(content);
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }

        } catch (IOException e) {

            logger.info(e.getMessage());
        }

        return checkTokenResponse;
    }
}
