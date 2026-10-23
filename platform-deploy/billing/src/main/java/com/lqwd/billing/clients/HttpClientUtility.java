package com.lqwd.billing.clients;

import com.google.gson.Gson;
import com.lqwd.billing.config.AppProperties;
import com.lqwd.billing.models.MainResponse;
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
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.HashMap;

@Service
@RequiredArgsConstructor
public class HttpClientUtility {

    private final AppProperties properties;

    private final Logger logger = LoggerFactory.getLogger(HttpClientUtility.class);


    public HttpPost getHttpPost(String action, String clientId, String clientSecret) {

        HttpPost postRequest = new HttpPost(properties.getOauthServerBaseUrl() + action);

        String encoding = java.util.Base64.getEncoder()
                .encodeToString((clientId + ":"
                        + clientSecret).getBytes());


        postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Basic " + encoding);
        return postRequest;
    }


    public HttpPost getHttpPost(String action, HashMap<String, String> parts) {

        HttpPost postRequest = getHttpPost(action, properties.getClientId(), this.properties.getClientSecret());

        MultipartEntityBuilder multipartEntityBuilder = MultipartEntityBuilder
                .create()
                .addPart("client_id", new StringBody(properties.getClientId(),
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


    public HttpPost getHttpPostJSON(String action, HashMap<String, String> parts) throws UnsupportedEncodingException {

        HttpPost postRequest = getHttpPost(action, properties.getClientId(),
                properties.getClientSecret());

        Gson gson = new Gson();

        StringEntity postingString = new StringEntity(gson.toJson(parts));//gson.tojson() converts your pojo to json
        postRequest.setEntity(postingString);

        return postRequest;
    }


    public MainResponse httpConnection(HttpPost postRequest, String className) {

        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode != 200) {
                mainResponse.setStatus(statusCode);
                mainResponse.setError(content);
                mainResponse.setClass_name(className);

                return mainResponse;
            }

            mainResponse.setStatus(200);
            mainResponse.setClass_name(className);
            mainResponse.setObject(content);

            return mainResponse;


        } catch (IOException e) {
            logger.info("Connection Error : repeated time 5 : {}", e.getMessage());
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            mainResponse.setClass_name(className);
        }

        return mainResponse;
    }


}
