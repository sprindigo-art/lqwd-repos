package lqwd.frontend.httpclient;

import com.fasterxml.jackson.core.JsonParseException;
import com.google.gson.*;
import lombok.SneakyThrows;
import lqwd.frontend.configuration.GlobalProperties;
import lqwd.frontend.model.*;
import org.apache.commons.codec.binary.Hex;
import org.apache.commons.lang3.StringUtils;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.NameValuePair;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpDelete;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.*;


@Component
public class HttpClientLnd {
    private static Logger logger = LoggerFactory.getLogger(HttpClientLnd.class);

    @Value("${app.auth_post_url}")
    private String appAuthPostUrl;

    @Value("${app.auth_password}")
    private String appAuthPassword;

    @Value("${app.auth_user_name}")
    private String appAuthUserName;

    @Value("${app.auth_post_port}")
    private String appAuthPostPort;

    @Value("${app.auth_client_id}")
    private String appAuthClientId;

    @Value("${app.lndap_url}")
    private String lndAP_URL;

    @Value("${app.lndap_port}")
    private String lndAP_Port;

    @Value("${app.auth_grand_type}")
    private String authGrandType;

    //check that response is json
    public boolean isJson(String content){
        try{
            JSONObject jsonObject = new JSONObject(content);
        }catch (JSONException jsonException){
            jsonException.printStackTrace();
            return false;
        }
        return true;
    }

    //for all POST requests to DLA
    private String getPostRequest(List<NameValuePair> params, String token, String action, List<NameValuePair> headers) throws UnsupportedEncodingException {
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10*1000);
        requestBuilder.setConnectionRequestTimeout(10*1000);
        requestBuilder.setSocketTimeout(10*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();


        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s",appAuthPostUrl,appAuthPostPort,action));


        if (token != null) {
            postRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        }
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        postRequest.addHeader("token", token);

        if(headers != null) {
            for (NameValuePair header : headers) {
                postRequest.addHeader(header.getName(), header.getValue());
            }
        }

        if(params != null) {
            HttpEntity entity = new UrlEncodedFormEntity(params);
            postRequest.setEntity(entity);
        }

        logger.info(postRequest.toString());
        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {
                if (isJson(content)) {
                    JSONObject jsonObject = new JSONObject(content);

                    if (!jsonObject.isNull("error")) {
                        if (jsonObject.get("error").equals("Token expired or wrong")) {
                            logger.error(jsonObject.getString("error"));
                            return null;
                        }
                    }
                    return content;
                }
                return null;

            } else if (statusCode == 403) {
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return null;
            } else {
                logger.info("action = " + action);
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

    //POST Request with Custom Time
    private String getPostRequest(List<NameValuePair> params, String token, String action, List<NameValuePair> headers, Integer queryWaitTimeSeconds) throws UnsupportedEncodingException {
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(queryWaitTimeSeconds*1000);
        requestBuilder.setConnectionRequestTimeout(queryWaitTimeSeconds*1000);
        requestBuilder.setSocketTimeout(queryWaitTimeSeconds*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();


        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s",appAuthPostUrl, appAuthPostPort,action));


        postRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/json");
//        postRequest.addHeader("token", token);

        if(headers != null) {
            for (NameValuePair header : headers) {
                postRequest.addHeader(header.getName(), header.getValue());
            }
        }

        if(params != null) {
            HttpEntity entity = new UrlEncodedFormEntity(params);
            postRequest.setEntity(entity);
        }

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {
                if (isJson(content)) {
                    JSONObject jsonObject = new JSONObject(content);

                    if (!jsonObject.isNull("error")) {
                        if (jsonObject.get("error").equals("Token expired or wrong")) {
                            logger.error(jsonObject.getString("error"));
                            return null;
                        }
                    }
                    return content;
                }
                return null;

            } else if (statusCode == 403) {
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return null;
            } else {
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

    //POST Request with Specified Content Type and Time
    private String getPostRequest(List<NameValuePair> params, String token, String action, List<NameValuePair> headers, Integer queryWaitTimeSeconds, String contentType) throws UnsupportedEncodingException {
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();

        if (queryWaitTimeSeconds != null) {
            requestBuilder.setConnectTimeout(queryWaitTimeSeconds * 1000);
            requestBuilder.setConnectionRequestTimeout(queryWaitTimeSeconds * 1000);
            requestBuilder.setSocketTimeout(queryWaitTimeSeconds * 1000);
        }
        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s",appAuthPostUrl, appAuthPostPort,action));

        postRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, contentType);

        if(headers != null) {
            for (NameValuePair header : headers) {
                postRequest.addHeader(header.getName(), header.getValue());
            }
        }

        if(params != null) {
            if(contentType.equals("application/json")){
                JSONObject jsonObject = new JSONObject();
                if(action.equals("/api/v1/liquidity")){
                    for(NameValuePair param: params){
                        if (param.getName().equals("numberOfWeeks")) {
                            jsonObject.put(param.getName(), Integer.parseInt(param.getValue()));
                        } else if (param.getName().equals("amount")) {
                            jsonObject.put(param.getName(), (int) Double.parseDouble(param.getValue()));
                        }
                        else {
                            if (StringUtils.isNumeric(param.getValue())) {
                                jsonObject.put(param.getName(), (int) Double.parseDouble(param.getValue()));
                            }else{
                                jsonObject.put(param.getName(), param.getValue());
                            }
                        }
                    }
                }else if(action.equals("/lnd/v1/chanpolicy")){
                    for(NameValuePair param: params){
                        if (param.getName().equals("chan_point")){
                            JSONObject jsonObject1 = new JSONObject(param.getValue());
                            jsonObject.put(param.getName(), jsonObject1);
                        } else {
                            if (StringUtils.isNumeric(param.getValue())) {
                                jsonObject.put(param.getName(), (int) Double.parseDouble(param.getValue()));
                            }else{
                                jsonObject.put(param.getName(), param.getValue());
                            }
                        }
                    }
                } else {
                    for(NameValuePair param: params){
                        if (StringUtils.isNumeric(param.getValue())) {
                            jsonObject.put(param.getName(), (int) Double.parseDouble(param.getValue()));
                        }else{
                            jsonObject.put(param.getName(), param.getValue());
                        }
                    }
                }
                logger.info(jsonObject.toString());
                HttpEntity entity = new StringEntity(jsonObject.toString());
                postRequest.setEntity(entity);
                logger.info(postRequest.toString());
            }else {
                HttpEntity entity = new UrlEncodedFormEntity(params);
                postRequest.setEntity(entity);
            }
        }

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {
                if (isJson(content)) {
                    JSONObject jsonObject = new JSONObject(content);

                    if (!jsonObject.isNull("error")) {
                        if (jsonObject.get("error").equals("Token expired or wrong")) {
                            logger.error(jsonObject.getString("error"));
                            return null;
                        }
                    }
                    return content;
                }
                return null;

            } else if (statusCode == 403) {
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return null;
            } else {
                logger.info("action = " + action);
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

    //for all GET requests to DLA
    private String getGetRequest(List<NameValuePair> headers, String action){
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10*1000);
        requestBuilder.setConnectionRequestTimeout(10*1000);
        requestBuilder.setSocketTimeout(10*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpGet getRequest = new HttpGet(String.format("http://%s:%s%s",this.appAuthPostUrl,this.appAuthPostPort,action));
        getRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        getRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        if(headers != null) {
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
                logger.info("action = " + action);
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                return content;
            }
        }catch(JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
//            content = null;

        }catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
        }

        return content;
    }

    private String getGetRequest(List<NameValuePair> headers, String action, String token){
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(60*1000);
        requestBuilder.setConnectionRequestTimeout(60*1000);
        requestBuilder.setSocketTimeout(60*1000);


        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpGet getRequest = new HttpGet(String.format("http://%s:%s%s",this.appAuthPostUrl,this.appAuthPostPort,action));

        getRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));

        getRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        getRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        if(headers != null) {
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
                        logger.error(jsonObject.getString("error"));
                        if (jsonObject.get("error").equals("Token expired or wrong")) {
                            return null;
                        }
                        return content;
                    }

                    return content;
                }
                return null;

            } else {
                logger.info("action = " + action);
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                return content;
            }
        }catch(JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
//            content = null;

        }catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
        }

        return content;
    }

    //GET Request with Bearer Token
    @SneakyThrows
    private String getGetRequest(List<NameValuePair> params, List<NameValuePair> headers, String action, String token, String contentType) {
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10 * 1000);
        requestBuilder.setConnectionRequestTimeout(10 * 1000);
        requestBuilder.setSocketTimeout(10 * 1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpGet getRequest = new HttpGet(String.format("http://%s:%s%s", this.appAuthPostUrl, this.appAuthPostPort, action));

        getRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        getRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        getRequest.addHeader(HttpHeaders.CONTENT_TYPE, contentType);

        if (headers != null) {
            for (NameValuePair header : headers) {
                getRequest.addHeader(header.getName(), header.getValue());
            }
        }

        if (params != null){
            URI uri = new URIBuilder(getRequest.getURI()).addParameters(params).build();
            getRequest.setURI(uri);
        }
        logger.info(getRequest.toString());
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

    //for managed lnd api
    private String connectBackEnd(String token, String lndname, String action){
        String content = null;
        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s",lndAP_URL,lndAP_Port,action));

        String encoding = java.util.Base64.getEncoder()
                .encodeToString((this.appAuthUserName + ":"
                        + this.appAuthPassword).getBytes());


        postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Bearer " + token);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        HttpEntity entity = MultipartEntityBuilder
                            .create()
                            .addPart("grant_type", new StringBody(authGrandType, ContentType.MULTIPART_FORM_DATA))
                            .addPart("client_id", new StringBody(appAuthClientId, ContentType.MULTIPART_FORM_DATA))
                            .addPart("lndname", new StringBody(lndname, ContentType.MULTIPART_FORM_DATA))
                            .build();

        postRequest.setEntity(entity);


//        Long timeNowInSec = System.currentTimeMillis()/1000;

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            int statusCode = httpResponse.getStatusLine().getStatusCode();

//            System.out.println(EntityUtils.toString(httpResponse.getEntity()));
            if(statusCode == 204){
                return  "{status:204; content:NO_CONTENT}";
            } else if (statusCode == 200) {
                content = EntityUtils.toString(httpResponse.getEntity());

//                System.out.println(content);
//                System.out.println("----------------------------------------------------");
                return content;
            } else if (statusCode == 403) {
                logger.info(EntityUtils.toString(httpResponse.getEntity()));
                return "{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}";
            } else {
                logger.info("action = " + action);
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            // handle exception
            logger.error(e.getMessage());
//            e.printStackTrace();
        }

        return content;
    }

    public  String getChannels(String token, String lndname) throws IOException {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/channels", token);
        return content;
    }
    public  String getChannelsFromDB(String token, String lndname, String pageNumber, String pageSize, String type) throws IOException {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();

        if (lndname != null) {
            params.add(new BasicNameValuePair("lndname", lndname));
        }

        if (pageNumber != null){
            params.add(new BasicNameValuePair("pageNumber", pageNumber));
        }

        if (pageSize != null){
            params.add(new BasicNameValuePair("pageSize", pageSize));
        }

        if (type != null){
            params.add(new BasicNameValuePair("types", type));
        }

        if (pageNumber != null){
            params.add(new BasicNameValuePair("pageNumber", pageNumber));
        }
        content = getGetRequest(params, null, "/api/v1/user_lnd_channels", token, "application/json");
        return content;
    }

    public String getInfo(String token, String lndname) throws IOException {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/getinfo", token);
        return content;
//        return connectBackEnd(token, lndname, "/lnd/getinfo");
    }

    public String getPeers(String token,  String lndname) {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/peers", token);
        return content;
//        return connectBackEnd(token, lndname, "/lnd/peers");
    }

    public String getFees(String token,  String lndname) {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/fees", token);
        return content;
//        return connectBackEnd(token, lndname, "/lnd/fees");
    }

    public String getWalletbalance(String token, String lndname) {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/balance/blockchain", token);
        return content;
//        return connectBackEnd(token, lndname, "/lnd/walletbalance");
    }

    public String getRecoveryinfo(String token, String lndname) {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/getrecoveryinfo", token);
        return content;
//        return connectBackEnd(token, lndname, "/lnd/getrecoveryinfo");
    }

    public String getChannelbalance(String token, String lndname) {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/balance/channels", token);
        return content;
//        return connectBackEnd(token, lndname, "/lnd/channelbalance");
    }

    public String consumerInfo(String token, String lndname) { return connectBackEnd(token, lndname, "/getdata"); }

    //get lnd node info for user
    public LndNode getLndNode(String token, String lndname) throws UnsupportedEncodingException {
        String content = null;
        LndNode lndNode = new LndNode();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("token", token));
        params.add(new BasicNameValuePair("lndname", lndname));

        logger.info(params.toString());
        content = getGetRequest(params, params, "/lndnode/getinfo", token, "application/json");
        logger.info(content);
        if(content != null && isJson(content)){
            lndNode = lndNode.mapContent(content);
        }
        return lndNode;
    }

    //get lnd node list from user token
    public ArrayList<LndNode> getLndNodeList(String token) throws UnsupportedEncodingException {

        String content = null;
        User user = new User();
        ArrayList<LndNode> lndNodes = new ArrayList<>();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("token", token));

        content = getGetRequest(params, params, "/lndnode/getlist", token, "application/json");
        if (content != null && isJson(content)){
            lndNodes = user.mapLndNodes(content);
        }
        return lndNodes;
    }

    //GET all active channels for a given node
    public ArrayList<LndChannel> getLndChannelList(String apikey, String lndname) throws UnsupportedEncodingException {

        String content = null;
        LndNode lndNode = new LndNode();
        ArrayList<LndChannel> lndChannels = new ArrayList<>();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/channels", apikey);

        if (content != null && isJson(content)){
            lndChannels = lndNode.mapLndChannels(content);
        }
        return lndChannels;
    }

    //GET all pending channels
    public String getPendingLndChannelList(String apikey, String lndname) throws UnsupportedEncodingException {

        String content = null;
        LndNode lndNode = new LndNode();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/channels/pending", apikey);

        return content;
    }

    //GET all channels closed
    public ArrayList<LndChannel> getClosedLndChannelList(String apikey, String lndname) throws UnsupportedEncodingException {

        String content = null;
        LndNode lndNode = new LndNode();
        ArrayList<LndChannel> lndChannels = new ArrayList<>();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(params, "/lnd/v1/channels/closed", apikey);

        if (content != null && isJson(content)){
            lndChannels = lndNode.mapLndChannels(content);
        }
        return lndChannels;
    }

    //get detailed lnd node info
    public LndNodeInfo getLndNodeInfo(String apikey, String lndname) throws UnsupportedEncodingException {
        String content = null;
        LndNodeInfo lndNode = new LndNodeInfo();

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/getinfo", apikey);
        logger.info(content);
        if (content != null && isJson(content)){
            lndNode = lndNode.mapContent(content);
        }

        return lndNode;
    }

    //get wallet balance of on chain balance
    public String getLndNodeWalletBalance(String apikey, String lndname) throws UnsupportedEncodingException {

        String content = null;
        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/balance/blockchain", apikey);
        if(content != null && isJson(content)) {
            return content;
        }
        return null;
    }

    //create channel request to specified node
    public String createLNDChannel(String apikey, String lndname, String node_pubkey_string, String local_funding_amount,
                                   String passphrase, String sat_per_vbyte, Integer min_htlc, Boolean private_chan) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));
        if (!passphrase.equals("")) {
            headers.add(new BasicNameValuePair("passphrase", passphrase));
        }

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("node_pubkey_string", node_pubkey_string));
        params.add(new BasicNameValuePair("local_funding_amount", local_funding_amount));

        if(min_htlc != null || !min_htlc.equals("")){
            params.add(new BasicNameValuePair("min_htlc_msat", String.valueOf(min_htlc)));
        }

        if(private_chan != null){
            params.add(new BasicNameValuePair("private", String.valueOf(private_chan)));
        }

        if(sat_per_vbyte != null || sat_per_vbyte != ""){
            params.add(new BasicNameValuePair("sat_per_vbyte", sat_per_vbyte));
        }

        content = getPostRequest(params, apikey, "/lnd/v1/channels", headers,30, "application/json");
        return content;
    }

    //create invoice to get payment request (provides payment request)
    public String createInvoice(String apikey, String lndname, int amount, String passphrase) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));
        if (!passphrase.equals("")) {
            headers.add(new BasicNameValuePair("passphrase", passphrase));
        }

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("value", String.valueOf(amount)));

        content = getPostRequest(params, apikey, "/lnd/v1/invoices", headers,30, "application/json");
        return content;
    }

    //send payment (retreive payment request and amount)
    public String sendPayment(String apikey, String lndname, String payment_request, String dest_str, String passphrase) throws UnsupportedEncodingException {

        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));
        if(passphrase != null){
            headers.add(new BasicNameValuePair("passphrase", passphrase));
        }


        List<NameValuePair> params = new ArrayList<>();
//        params.add(new BasicNameValuePair("amt", amount));
        params.add(new BasicNameValuePair("payment_request", payment_request));

        content = getPostRequest(params, apikey, "/lnd/send-payment", headers, 30, "application/json");
        return content;

    }

    //send payment (retreive payment request and amount)
    public String sendBtcPayment(String apikey, String lndname,  String amount, String btcAddress, String passphrase) throws UnsupportedEncodingException {

        String content = null;
        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));
        if(passphrase != null){
            headers.add(new BasicNameValuePair("passphrase", passphrase));
        }

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("amount", amount));
        params.add(new BasicNameValuePair("addr", btcAddress));

        content = getPostRequest(params, apikey, "/lnd/send-btc-payment", headers, 30, "application/json");
        return content;

    }

    public String sendKeysendPayment(String apikey, String lndname, String amount, String pubkey_dest, String passphrase) throws UnsupportedEncodingException, NoSuchAlgorithmException, InvalidKeyException {
        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));
        if(passphrase != null){
            headers.add(new BasicNameValuePair("passphrase", passphrase));
        }


        //create preimage with secure random 32 bytes
        byte[] nonce = new byte[32];
        new SecureRandom().nextBytes(nonce);

//        MessageDigest messageDigest = MessageDigest.getInstance("SHA-256");
//        nonce = messageDigest.digest(nonce);

//        StringBuilder stringBuilder = new StringBuilder();
//        for(byte temp : nonce){
//            stringBuilder.append(String.format("%02x", temp));
//        }

        Base64.Encoder encode = Base64.getEncoder();

        Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
        SecretKeySpec generatePreImage = new SecretKeySpec(nonce, "HmacSHA256");
        sha256_HMAC.init(generatePreImage);

        byte[] preImage = sha256_HMAC.doFinal();
        //create preimage hex
//        String preImage = stringBuilder.toString();
        String preImageB64 = encode.encodeToString(preImage);

        logger.info(preImageB64);

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(preImage);

        //create payment hash by converting preimage bytes to base 64
        String payment_hash = encode.encodeToString(hash);
        logger.info(payment_hash);

        //create base64 pubkey encoded (destination)
        String pubkeyB64 = encode.encodeToString(pubkey_dest.getBytes());
        logger.info(pubkeyB64);

        /*
            Rest Structure
            ---
            dest: pubkeyBase64
            amt: local_amount
            payment_hash: paymentHashBase64
            dest_custom_records: {
                "5482373484" : preImageBase64
            }
         */

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("amt", amount));
        params.add(new BasicNameValuePair("dest", pubkeyB64));

        String content = getPostRequest(params, apikey, "/lnd/v1/channels/transactions", headers, 30, "application/json");
        return content;
    }
    //GET create payment request
    public String getPaymentDetails(String apikey, String lndname, String pay_req) {
        //GET http://192.168.123.252:8690/lnd/v1/payreq/:pay_req
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/payreq/"+pay_req, apikey);
        logger.info(headers.toString());
        logger.info("/lnd/v1/payreq/"+pay_req, apikey);
        logger.info("content: "+content);
        return content;
    }

    //GET all invoices on node (for later possibly)
    public String getAllInvoices(String apikey, String lndname) {
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/invoices", apikey);
        if(content != null && isJson(content)){
            return content;
        }
        return null;
    }

    //GET specific invoice details using r_hash
    public String getInvoiceDetails(String apikey, String lndname, String r_hash) {
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/invoice/"+ Hex.encodeHexString(Base64.getDecoder().decode(r_hash)), apikey);

        return content;
    }
    public String getLiquidityInvoiceDetailsById(String token, int pageNumber, int pageSize) {

        String content = "";
        String action = "/api/v1/liquidity/invoices?pageNumber="+pageNumber+"&pageSize="+pageSize;

        content = getGetRequest(null, action,token);
        logger.info(content);
        System.out.println("http content: "+content);
        return content;
    }
    public String getLiquidityBtcDetailsById(String token, int pageNumber, int pageSize) {

        String content = "";
        String action = "/api/v1/liquidity/btc?pageNumber="+pageNumber+"&pageSize="+pageSize;

        content = getGetRequest(null, action,token);
        logger.info(content);
        System.out.println("http content: "+content);
        return content;
    }
    //send  liquidity request
    public String sendRequestLiquidity (String pubkey, int amount, int numberOfWeeks,
                                        String nodeAddress, String type, String token) throws UnsupportedEncodingException {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("amount", Double.toString(amount)));
        params.add(new BasicNameValuePair("numberOfWeeks", String.valueOf(numberOfWeeks)));
        params.add(new BasicNameValuePair("nodeAddress", nodeAddress));
        params.add(new BasicNameValuePair("pubKey", pubkey));
        params.add(new BasicNameValuePair("type", type));
        content = getPostRequest(params, token, "/api/v1/liquidity", null,
                240,"application/json");
        logger.info("content="+content);
        return content;
    }

    //finalizy liquidity
    public String finalizeLiquidity (long liquidityId, String token) throws UnsupportedEncodingException {
        String content = "";
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("liquidityId", String.valueOf(liquidityId)));
        content = getPostRequest(params, token, "/api/v1/liquidity/finalize", null,240,"application/json");
        return content;
    }

    //Create LND Node for User
    public String createPersonalLNDNode(String token, String username, String password, String network, String breez, String alias, String passphrase, Boolean keySendEnabled) throws UnsupportedEncodingException {

        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("username", username));
        params.add(new BasicNameValuePair("password", password));
        params.add(new BasicNameValuePair("lndNetwork", network.toUpperCase()));
        params.add(new BasicNameValuePair("routingNode", "false"));
        params.add(new BasicNameValuePair("watchtower", "false"));
        params.add(new BasicNameValuePair("breezLnd", breez));
        params.add(new BasicNameValuePair("alias",alias));
        params.add(new BasicNameValuePair("walletPassword",password));
        params.add(new BasicNameValuePair("keySendEnabled",String.valueOf(keySendEnabled)));
        if(passphrase != null){
            params.add(new BasicNameValuePair("passphrase",passphrase));
            params.add(new BasicNameValuePair("isNonCustodial","true"));
        }else{
            params.add(new BasicNameValuePair("isNonCustodial","false"));
        }

        content = getPostRequest(params, token,"/kubernetes/lnd_node/create", null, 240, "application/json");
        return content;
    }


    //get all transactions for a given node
    public ArrayList<Transaction> getAllTransactionsByNode(String apikey, String lndname, String currency, BitcoinPrice bitcoinPrice){
        String content = null;
        Transaction transaction = new Transaction();
        ArrayList<Transaction> transactions = new ArrayList<>();

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/transactions", apikey);

        if(content != null && isJson(content)){
            transactions = transaction.mapTransactionList(content, currency, bitcoinPrice, lndname);
        }
        return transactions;
    }

    //get all transactions for a given node return string content
    public String getAllTransactionsByNodeContent(String apikey, String lndname){
        String content = null;
        Transaction transaction = new Transaction();
        ArrayList<Transaction> transactions = new ArrayList<>();

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));
        content = getGetRequest(headers, "/lnd/v1/transactions", apikey);
        return content;
    }

    //close channel
    public String closeChannel(String apikey, String lndname, String channel_point, String passphrase, boolean force) throws UnsupportedEncodingException {
//        DELETE /v1/channels/abandon/{channel_point.funding_txid_str}/{channel_point.output_index}
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(30*1000);
        requestBuilder.setConnectionRequestTimeout(30*1000);
        requestBuilder.setSocketTimeout(30*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpDelete httpDelete = new HttpDelete(String.format("http://%s:%s/lnd/v1/channels/%s/%s?force=%b", this.appAuthPostUrl,
                this.appAuthPostPort, channel_point.split(":")[0], channel_point.split("[\\s:]")[1], force));

        httpDelete.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", apikey));
        httpDelete.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        httpDelete.addHeader(HttpHeaders.ACCEPT, "application/json");
        httpDelete.addHeader("lndname", lndname);
        if (!passphrase.equals("")) {
            httpDelete.addHeader("passphrase", passphrase);
        }


        logger.info(httpDelete.toString());
        try (CloseableHttpResponse httpResponse = client.execute(httpDelete)) {
            content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 200) {

                return content;

            } else {
                logger.info("action = closeChannel");
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                return content;
            }
        }catch(JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
//            content = null;

        }catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
        }

        return content;
    }

    //update channel policy
    public String updateChannelPolicy(String token, String lndname, String channel_point, String passphrase,
                                      String base_fee_msat, String fee_rate_ppm, String min_htlc_msat, String max_htlc_msat,
                                      String time_lock_delta) throws UnsupportedEncodingException {
        String content = null;
        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        if(passphrase != null){
            headers.add(new BasicNameValuePair("passphrase",passphrase));
        }

        List<NameValuePair> params = new ArrayList<>();

        JSONObject jsonObject = new JSONObject();
        jsonObject.put("funding_txid_str", channel_point.split(":")[0]).put("output_index", channel_point.split(":")[1]);

        params.add(new BasicNameValuePair("chan_point", jsonObject.toString()));
        params.add(new BasicNameValuePair("time_lock_delta", time_lock_delta));

        if (base_fee_msat != null && !base_fee_msat.equals("")) {
            params.add(new BasicNameValuePair("base_fee_msat", base_fee_msat));
        }
        if (fee_rate_ppm != null && !fee_rate_ppm.equals("")) {
            params.add(new BasicNameValuePair("fee_rate_ppm", fee_rate_ppm));
        }
        if (min_htlc_msat != null && !min_htlc_msat.equals("")) {
            params.add(new BasicNameValuePair("min_htlc_msat", min_htlc_msat));
        }
        if (max_htlc_msat != null && !max_htlc_msat.equals("")) {
            params.add(new BasicNameValuePair("max_htlc_msat", max_htlc_msat));
        }

        content = getPostRequest(params, token, "/lnd/v1/chanpolicy", headers, 30, "application/json");
        return content;
    }
    //close inactive channel
    public String closeInactiveChannel(String apikey, String lndname, String channel_point){
        String content = null;
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10*1000);
        requestBuilder.setConnectionRequestTimeout(10*1000);
        requestBuilder.setSocketTimeout(10*1000);
        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();
        HttpDelete httpDelete = new HttpDelete(String.format("http://%s:%s/lnd/v1/channels/abandon/%s/%s?i_know_what_i_am_doing=true", this.appAuthPostUrl,
                this.appAuthPostPort, channel_point.split(":")[0], channel_point.split("[\\s:]")[1]));

        httpDelete.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", apikey));
        httpDelete.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        httpDelete.addHeader(HttpHeaders.ACCEPT, "application/json");
        httpDelete.addHeader("apikey", apikey);
        httpDelete.addHeader("lndname", lndname);
        try (CloseableHttpResponse httpResponse = client.execute(httpDelete)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                return content;
            } else {
                logger.info("action = closeInactiveChannel");
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                return content;
            }
        }catch(JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
        }catch (IOException e) {
            logger.info(e.getMessage());
        }

        return content;
    }

    //close lnd node
    public String closeLndNode(String token, String lndname, String username, String password, boolean force) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("username", username));
        params.add(new BasicNameValuePair("password", password));
        params.add(new BasicNameValuePair("lndname", lndname));
        params.add(new BasicNameValuePair("force", Boolean.toString(force)));

        content = getPostRequest(params, token, "/kubernetes/lndnode/destroy", null, null, "application/json");

        return content;

    }

    //create LQwD Node
    public String createAddress(String apikey, String lndname, String passphrase) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        if (passphrase != null && !passphrase.equals("")) {
            headers.add(new BasicNameValuePair("passphrase", passphrase));
        }

        content = getPostRequest(null, apikey, String.format("/api/v1/lnd_address/%s/new_address", lndname), headers);

        if(content != null && isJson(content)){
            return content;
        }
        return null;
    }

    //connect to peer or check if connected
    public String connectToPeer(String apikey, String lndname, String pubkey, String host, String port, String passphrase) throws UnsupportedEncodingException {
        String content = null;
        LndNode lndNode = new LndNode();

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));
        if (!passphrase.equals("")) {
            headers.add(new BasicNameValuePair("passphrase", passphrase));
        }


        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("addr", "{\"pubkey\":\""+pubkey+"\", \"host\": \""+host+":"+port+"\"}"));
        params.add(new BasicNameValuePair("timeout", "30"));

        content = getPostRequest(params, apikey, "/lnd/v1/peers", headers,30, "application/json");

        if(content != null && isJson(content)){
            return content;
        }
        return null;
    }

    //disconnect from peer
    public String disconnectFromPeer(String apikey, String lndname, String pubkey, String passphrase) throws UnsupportedEncodingException {
        String content = null;
        HttpDelete httpDelete = new HttpDelete(String.format("http://%s:%s/lnd/v1/peers/%s",this.appAuthPostUrl,this.appAuthPostPort,pubkey));


        httpDelete.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        httpDelete.addHeader(HttpHeaders.ACCEPT, "application/json");
        httpDelete.addHeader("lndname", lndname);
        if (!passphrase.equals("")) {
            httpDelete.addHeader("passphrase", passphrase);
        }


        CloseableHttpClient client = HttpClientBuilder.create().build();

        try (CloseableHttpResponse httpResponse = client.execute(httpDelete)) {
            content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 200) {

                return content;

            } else {
                logger.info("action = /lnd/v1/peers/" + pubkey);
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                return content;
            }
        }catch(JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
//            jsonParseException.printStackTrace();
            content = null;

        }catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
        }

        return content;
    }

    //create watchtower
    public String createWatchtower(String token, String username, String password, String network,String breez, String alias, String passphrase) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("username", username));
        params.add(new BasicNameValuePair("password", password));
        params.add(new BasicNameValuePair("lndNetwork", network.toUpperCase()));
        params.add(new BasicNameValuePair("routingNode","false"));
        params.add(new BasicNameValuePair("watchtower", "true"));
        params.add(new BasicNameValuePair("breezLnd", breez));
        params.add(new BasicNameValuePair("alias",alias));
        params.add(new BasicNameValuePair("walletPassword",password));
        if(passphrase != null){
            params.add(new BasicNameValuePair("passphrase",passphrase));
            params.add(new BasicNameValuePair("isNonCustodial","true"));
        }else{
            params.add(new BasicNameValuePair("isNonCustodial","false"));
        }
//        List<NameValuePair> params = new ArrayList<>();
//        params.add(new BasicNameValuePair("timeout", "30"));

        content = getPostRequest(params, token, "/kubernetes/lnd_node/create", null, 240, "application/json");

        return content;
    }

    //Create Routing Node for User
    public String createRoutingNode(String token, String username, String password, String network,String breez, String alias, String passphrase, Boolean keySendEnabled) throws UnsupportedEncodingException {

        String content = null;
        LndNode lndNode = new LndNode();

        TokenKey tokenKey = new TokenKey();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("username", username));
        params.add(new BasicNameValuePair("password", password));
        params.add(new BasicNameValuePair("lndNetwork", network.toUpperCase()));
        params.add(new BasicNameValuePair("routingNode","true"));
        params.add(new BasicNameValuePair("watchtower", "false"));
        params.add(new BasicNameValuePair("breezLnd", breez));
        params.add(new BasicNameValuePair("alias",alias));
        params.add(new BasicNameValuePair("walletPassword",password));
        params.add(new BasicNameValuePair("keySendEnabled",String.valueOf(keySendEnabled)));
        if(passphrase != null){
            params.add(new BasicNameValuePair("passphrase",passphrase));
            params.add(new BasicNameValuePair("isNonCustodial","true"));
        }else{
            params.add(new BasicNameValuePair("isNonCustodial","false"));
        }


        content = getPostRequest(params, token,"/kubernetes/lnd_node/create", null, 240, "application/json");
        return content;
    }

    //get list of all addresses from specific lnd
    public String getAllAddressesByLnd(String token, String lndname){
        String content;
        content = getGetRequest(null, String.format("/api/v1/lnd_address/%s", lndname), token);
        return content;
    }

    //get all peers
    public String getAllPeersByLnd(String token, String lndname){
        String content = null;
        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, String.format("/lnd/v1/peers"), token);
        return content;
    }

    //get all payments from node
    public String getAllPaymentsByLnd(String token, String lndname){
        String content = null;
        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/payments", token);
        return content;
    }

    //get node info from pubkey
    public String getNodeInfo(String token, String lndname, String pubkey){
        String content = null;
        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, "/lnd/v1/graph/node/"+pubkey, token);
        return content;
    }

    //unlock lnd request
    public String unlockLndRequest(String token, String lndname, String passphrase) throws UnsupportedEncodingException {

        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));
        params.add(new BasicNameValuePair("passphrase", passphrase));
        content = getPostRequest(params, token,"/lnd/unlockwallet", null, 240, "application/json");
        return content;
    }

    //restart lnd request
    public String restartLndRequest(String token, String lndname, String passphrase) throws UnsupportedEncodingException {

        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));
        params.add(new BasicNameValuePair("passphrase", passphrase));
        content = getPostRequest(params, token,"/lnd/restart", null, 240, "application/json");
        return content;
    }

    //get fee estimate for payment
    public String getFeeEstimate(String token, String lndname, String pubkey, String amt){
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        content = getGetRequest(headers, String.format("/lnd/v1/graph/routes/%s/%s", pubkey, amt), token);
        return content;
    }

    //get seed for non custodial node
    public String getNonCustodialSeed(String token, String  lndname) throws UnsupportedEncodingException {

        String content = null;

        content = getGetRequest(null, String.format("/lnd/getseed?lndname=%s", lndname), token);

        return content;
    }

    //set running status for non custodial node after successful mnemonic quiz
    public String setNonCustodialRunning(String token, String lndname) throws UnsupportedEncodingException {

        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getPostRequest(params, token, "/lnd/setrunning", null, null, "application/json");
        return content;
    }

    //set confirmed for lnd node
    public String setConfirmed(String token, String lndname) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getPostRequest(params, token, "/lnd/confirm", null, null, "application/json");
        logger.info(content);
        return content;
    }

    //Get All Invoices by LND from DB
    public String getAllInvoicesPaginated(String token, String lndname, String state, String pageNumber, String pageSize) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        if (pageNumber != null) {
            params.add(new BasicNameValuePair("pageNumber", pageNumber));
        }

        if(pageSize != null) {
            params.add(new BasicNameValuePair("pageSize", pageSize));
        }

        if(state != null) {
            params.add(new BasicNameValuePair("state", state));
        }

        content = getGetRequest(params, null, "/api/v1/invoices", token, "application/json");
        return content;
    }

    //Get All Payments by LND from DB
    public String getAllPaymentsPaginated(String token, String lndname, String pageNumber, String pageSize, Boolean shouldSync) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        if (pageNumber != null) {
            params.add(new BasicNameValuePair("pageNumber", pageNumber));
        }

        if(pageSize != null) {
            params.add(new BasicNameValuePair("pageSize", pageSize));
        }

        if(shouldSync != null) {
            params.add(new BasicNameValuePair("shouldSync", String.valueOf(shouldSync)));
        }

        content = getGetRequest(params, null,"/api/v1/payments",  token,"application/json");
        return content;
    }

    //Get All On-Chain Transactions by LND from DB
    public String getAllTransactionsPaginated(String token, String lndname, String pageNumber, String pageSize) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        if (pageNumber != null) {
            params.add(new BasicNameValuePair("pageNumber", pageNumber));
        }

        if(pageSize != null) {
            params.add(new BasicNameValuePair("pageSize", pageSize));
        }

        content = getGetRequest(params, null,"/api/v1/transactions", token, "application/json");
        return content;
    }

    //sync channels
    public String syncChannels(String token, String lndname) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("lndname", lndname));

        content = getPostRequest(params, token,"/api/v1/sync_channels", null);
        return content;
    }

    //on-chain transaction estimate
    public String getTransactionEstimate(String token, String lndname, String address, String value, String target_conf) {
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("lndname", lndname));

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("target_conf", target_conf));
        params.add(new BasicNameValuePair(String.format("AddrToAmount[%s]", address), value));


        content = getGetRequest(params, headers,"/lnd/v1/transactions/fee", token, "application/json");
        return content;
    }
}
