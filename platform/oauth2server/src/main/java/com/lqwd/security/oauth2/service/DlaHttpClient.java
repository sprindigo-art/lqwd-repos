package com.lqwd.security.oauth2.service;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.lqwd.security.oauth2.config.AppProperties;
import com.lqwd.security.oauth2.model.response.DlaResponse;
import lombok.RequiredArgsConstructor;
import org.apache.http.Header;
import org.apache.http.HttpHeaders;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.message.BasicHeader;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RefreshScope
@Component
@RequiredArgsConstructor
public class DlaHttpClient {


    @Value("${app.dla_base_url}")
    private String baseURL;
    @Value("${server.port}")
    private int serverPort;
    private final AppProperties appProperties;

    private final static Logger logger = LoggerFactory.getLogger(DlaHttpClient.class);


    CloseableHttpClient httpclient;
    private String accessToken;
    private Date tokenExpiry;

    private Gson gson = new Gson();
    JsonParser parser = new JsonParser();

    @PostConstruct
    public void init() {
        this.httpclient = HttpClientBuilder.create().build();
    }

    public String getAccessToken() throws Exception {

        if (accessToken == null || tokenExpiry == null) {
            return getAccessTokenForWalletService();
        }

        if (new Date().compareTo(tokenExpiry) > 0)
            return getAccessTokenForWalletService();

        logger.info("retrieving token from cache");

        return accessToken;
    }

    private String getAccessTokenForWalletService() throws Exception {

        Calendar calendar = Calendar.getInstance();

        Map<String, Object> params = new HashMap<>();
        params.put("grant_type", "client_credentials");

        String encoding = java.util.Base64.getEncoder()
                .encodeToString((appProperties.getDla_client_credentials().get("username") + ":"
                        + appProperties.getDla_client_credentials().get("password")).getBytes());

        Header[] headers = new Header[1];
        headers[0] = new BasicHeader(HttpHeaders.AUTHORIZATION, "Basic " + encoding);

        DlaResponse response = post(String.format("http://localhost:%s/oauth/token", serverPort), params,
                "application/x-www-form-urlencoded", headers);

        if (response.getStatus() != 200)
            return null;

        JsonElement tokenResponse = parser.parse(response.getData());

        accessToken = tokenResponse.getAsJsonObject().get("access_token").getAsString();
        calendar.add(Calendar.SECOND, 300);

        tokenExpiry = calendar.getTime();

        return accessToken;

    }


    public DlaResponse openLiquidityChannel(Long liquidityId) throws Exception {

        String accessToken = getAccessToken();

        Map<String, Object> params = new HashMap<>();
        params.put("liquidityId", liquidityId.toString());


        Header[] headers = new Header[1];
        headers[0] = new BasicHeader(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken);

        return post(baseURL + "/api/v1/liquidity/create_channel", params,
                "application/x-www-form-urlencoded", headers);


    }


    public DlaResponse getLiquidityRequests(int pageNo, int pageSize) throws Exception {

        String accessToken = getAccessToken();

        Map<String, Object> params = new HashMap<>();
        params.put("pageNumber", pageNo);
        params.put("pageSize", pageSize);

        Header[] headers = new Header[1];
        headers[0] = new BasicHeader(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken);

        return get(baseURL + "/api/v1/liquidity/find_all", params, headers);


    }

    public DlaResponse getStakingList(int pageNo, int pageSize) throws Exception {

        String accessToken = getAccessToken();

        Map<String, Object> params = new HashMap<>();
        params.put("pageNumber", pageNo);
        params.put("pageSize", pageSize);

        Header[] headers = new Header[1];
        headers[0] = new BasicHeader(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken);

        return get(baseURL + "/api/v1/staking/find_all", params, headers);


    }

    public DlaResponse post(String url, Map<String, Object> values, String contentType, Header[] headers)
            throws Exception {

        HttpPost postRequest = new HttpPost(url);
        postRequest.setHeaders(headers);
        postRequest.setHeader("Accept", "*/*");

        if (contentType.equals("application/json")) {
            StringEntity entity = new StringEntity(gson.toJson(values));
            postRequest.setEntity(entity);
        } else {

            List<NameValuePair> params = new ArrayList<>();
            for (Map.Entry<String, Object> e : values.entrySet()) {
                params.add(new BasicNameValuePair(e.getKey(), e.getValue().toString()));
            }
            postRequest.setEntity(new UrlEncodedFormEntity(params));
        }

        return getHttpResponse(httpclient.execute(postRequest));
    }

    public DlaResponse get(String url, Map<String, Object> values, Header[] headers)
            throws Exception {


        URIBuilder builder = new URIBuilder(url);


        for (Map.Entry<String, Object> e : values.entrySet()) {
            builder.setParameter(e.getKey(), e.getValue().toString());
        }

        HttpGet get = new HttpGet(builder.build());
        get.setHeaders(headers);
        get.setHeader("Accept", "*/*");


        return getHttpResponse(httpclient.execute(get));
    }

    private DlaResponse getHttpResponse(CloseableHttpResponse execute) {

        try (CloseableHttpResponse httpResponse = execute) {

            String content = EntityUtils.toString(httpResponse.getEntity());

            logger.info("Dla response is: {}", content);

            int status = httpResponse.getStatusLine().getStatusCode();

            if (status != 200)
                return new DlaResponse(status, httpResponse.getStatusLine().getReasonPhrase(), content);


            return new DlaResponse(status, httpResponse.getStatusLine().getReasonPhrase(), content);


        } catch (IOException e) {

            logger.info("An exception occurred when sending http request: {}", e.getMessage());

        }

        return new DlaResponse(500, "An unknown error occurred", null);

    }

}
