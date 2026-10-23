package lqwd.frontend.httpclient;


import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsParameters;
import lombok.SneakyThrows;
import lqwd.frontend.configuration.GlobalProperties;
import lqwd.frontend.model.AccountInfo;
import lqwd.frontend.model.BusinessApplication;
import lqwd.frontend.model.Staking;
import lqwd.frontend.model.User;
import lqwd.frontend.service.UserService;
import org.apache.http.*;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.methods.HttpRequestBase;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;
import org.apache.http.impl.client.*;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RequestParam;

import javax.net.ssl.SSLParameters;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import javax.validation.constraints.Null;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Component
public class HttpClientStaking {
    private static TokenKey tokenKey = null;

    private static Logger logger = LoggerFactory.getLogger(HttpClientToken.class);

    @Value("${app.auth_post_url}")
    private String authPostUrl;

    @Value("${app.auth_post_port}")
    private String authPostUrlPort;

    @Value("${app.auth_user_name}")
    private String authUserName;

    @Value("${app.auth_password}")
    private String authPassword;

    @Value("${app.auth_client_id}")
    private String authClientId;

    @Value("${app.auth_grand_type}")
    private String authGrandType;

    //check that response is json
    public boolean isJson(String content) {
        try {
            JSONObject jsonObject = new JSONObject(content);
        } catch (JSONException jsonException) {
            return false;
        }
        return true;
    }

    //POST Request
    private String getPostRequest(List<NameValuePair> headers, List<NameValuePair> params, String token, String action, String contentType) throws UnsupportedEncodingException {
        String content = null;
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(15 * 1000);
        requestBuilder.setConnectionRequestTimeout(15 * 1000);
        requestBuilder.setSocketTimeout(15 * 1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s", authPostUrl, authPostUrlPort, action));
        if (token != null) {
            postRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        }
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, contentType);
        if (headers != null) {
            for (NameValuePair header : headers) {
                postRequest.addHeader(header.getName(), header.getValue());
            }
        }

        if (params != null) {
            if (contentType.equals("application/json")) {
                JSONObject jsonObject = new JSONObject();
                for (NameValuePair param : params) {
                    if (param.getName().equals("days")) {
                        jsonObject.put(param.getName(), Integer.parseInt(param.getValue()));
                    } else if (param.getName().equals("amount")) {
                        jsonObject.put(param.getName(), Double.parseDouble(param.getValue()));
                    } else {
                        jsonObject.put(param.getName(), param.getValue());
                    }

                }
                HttpEntity entity = new StringEntity(jsonObject.toString());
                postRequest.setEntity(entity);

            } else {
                HttpEntity entity = new UrlEncodedFormEntity(params);
                postRequest.setEntity(entity);
            }
        }
        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {

                content = EntityUtils.toString(httpResponse.getEntity());

                Gson gson = new GsonBuilder().setPrettyPrinting().create();
                JsonParser jp = new JsonParser();
                JsonElement je = jp.parse(content);
                String prettyJsonString = gson.toJson(je);

//                System.out.println(prettyJsonString);
//                System.out.println("----------------------------------------------------");

                return content;

            } else if (statusCode == 403) {
                logger.error(httpResponse.toString());
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return null;
            } else {
                logger.error(httpResponse.toString());
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
            return null;
        }
        return content;
    }

    //GET Request with Bearer Token
    @SneakyThrows
    private String getGetRequest(List<NameValuePair> headers, String action, String token, String contentType) {
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10 * 1000);
        requestBuilder.setConnectionRequestTimeout(10 * 1000);
        requestBuilder.setSocketTimeout(10 * 1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpGet getRequest = new HttpGet(String.format("http://%s:%s%s", this.authPostUrl, this.authPostUrlPort, action));

        getRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        getRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        getRequest.addHeader(HttpHeaders.CONTENT_TYPE, contentType);

        if (headers != null) {
            for (NameValuePair header : headers) {
                getRequest.addHeader(header.getName(), header.getValue());
            }
        }
        try (CloseableHttpResponse httpResponse = client.execute(getRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                if (isJson(content)) {
                    JSONObject jsonObject = new JSONObject(content);

                    if (!jsonObject.isNull("error")) {
                        if (jsonObject.get("error").equals("Token expired or wrong")) {
                            logger.error(jsonObject.getString("error"));
                            return null;
                        }
                        return null;
                    }

                    return content;
                }
                return null;

            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                return content;
            }
        } catch (JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
//            content = null;

        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
        }

        return content;
    }


    // POST staking request
    public String stakingRequest(Staking staking, String token, User user) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("amount", Double.toString(staking.getAmount())));
        params.add(new BasicNameValuePair("days", String.valueOf(staking.getTotalDays())));
        params.add(new BasicNameValuePair("pubKey", staking.getPubKey()));
        params.add(new BasicNameValuePair("ipAddress", staking.getIpAddress()));
        params.add(new BasicNameValuePair("type", staking.getType()));

        logger.info(params.toString());
        content = getPostRequest(null, params, token, "/api/v1/staking/request", "application/json");
        logger.info(content);
        return content;

    }

    public String getListOfStakingRequests(@RequestParam String token,
                                           @RequestParam("page") Optional<Integer> page,
                                           @RequestParam(required = false) int size,
                                           @RequestParam(required = false) String status,
                                           @RequestParam("query")
                                                   Optional<String> query) {
        String action = "/api/v1/staking/list?";
        if (page.isPresent()) {
            action = action + "page=" + page.get();
        }
        if (size != 0) {
            action = action + "&size=" + size;
        }
        if (status != null) {
            action = action + "&status=" + status;
        }
        if (query.isPresent()) {
            action = action + "&query=" + query;
        }

        String content = null;
        content = getGetRequest(null, action, token, "application/json");
        logger.info(content);
        return content;
    }
    // POST staking renew request
    public String stakingRenewRequest(String paymentRequest, String token, int days, String type, String password) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("paymentRequest", paymentRequest));
        params.add(new BasicNameValuePair("days", String.valueOf(days)));
        params.add(new BasicNameValuePair("type", type));
        params.add(new BasicNameValuePair("password", password));
        logger.info(params.toString());
        content = getPostRequest(null, params, token, "/api/v1/staking/renew", "application/json");
        logger.info(content);
        return content;
    }
    //POST withdraw staking request
    public String stakingWithdrawRequest(String paymentRequest, String token, String type, String password) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("paymentRequest", paymentRequest));
        params.add(new BasicNameValuePair("type", type));
        params.add(new BasicNameValuePair("password", password));
        logger.info(params.toString());
        content = getPostRequest(null, params, token, "/api/v1/staking/withdraw","application/json" );
        logger.info(content);
        return content;
    }
}

