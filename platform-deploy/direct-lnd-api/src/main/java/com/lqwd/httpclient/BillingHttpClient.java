package com.lqwd.httpclient;

import com.google.gson.Gson;
import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.IOException;
import java.util.Map;
import java.util.Optional;


@Service
@RequiredArgsConstructor
public class BillingHttpClient {

    private Logger logger = LoggerFactory.getLogger(BillingHttpClient.class);

    private final AppProperties properties;

    private CloseableHttpClient httpclient;

    @PostConstruct
    public void init() {

        this.httpclient = HttpClientBuilder.create()
                .build();

    }


    public String subscribe(String accessToken, Map<String, Object> request) throws Exception {
        return post("/api/v1/subscription", accessToken, Optional.of(request));
    }

    private String post(String path, String accessToken,
                        Optional<Map<String, Object>> values) throws Exception {

        URIBuilder builder = new URIBuilder(String.format("%s%s",
                properties.getBillingServiceAddr(), path));


        HttpPost postRequest = new HttpPost(builder.build());
        postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken);
        postRequest.addHeader("Content-type", "application/json");

        if (values.isPresent()) {
            Gson gson = new Gson();

            StringEntity postingString = new StringEntity(gson.toJson(values.get()));//gson.tojson() converts your pojo to json
            postRequest.setEntity(postingString);
        }


        try (CloseableHttpResponse httpResponse = this.httpclient.execute(postRequest)) {

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            String content = EntityUtils.toString(httpResponse.getEntity());
            logger.info("Billing Http client Content" + values.get() + " : -- " +  content);
            if (statusCode != 200) {
                logger.info("billing post request failed, url: {} , status: {}", postRequest.getURI(),
                        statusCode);
                throw new BadRequestException(statusCode, content);
            }


            return content;


        } catch (IOException e) {

            logger.info("An exception occurred while running post request: {}, exception: {}", postRequest.getURI(),
                    e.getMessage());

            throw new BadRequestException(500,
                    "An error occurred when communicating with billing service");
        }

    }


}
