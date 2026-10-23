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
import lqwd.frontend.configuration.GlobalProperties;
import lqwd.frontend.model.AccountInfo;
import lqwd.frontend.model.BusinessApplication;
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

@Component
public class HttpClientToken {
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
    public boolean isJson(String content){
        try{
            JSONObject jsonObject = new JSONObject(content);
        }catch (JSONException jsonException){
            return false;
        }
        return true;
    }

    //get POST request for all backend request
    private String getPostRequest(List<NameValuePair> params, String token, String action) throws UnsupportedEncodingException {
        String content = null;
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(15*1000);
        requestBuilder.setConnectionRequestTimeout(15*1000);
        requestBuilder.setSocketTimeout(15*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s" ,authPostUrl, authPostUrlPort, action));
        logger.info(postRequest.toString());
        if(token != null) {
            postRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        }
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");

        HttpEntity entity = new UrlEncodedFormEntity(params);
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            content = EntityUtils.toString(httpResponse.getEntity());
            logger.info(content);

            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {
                return content;

            } else if (statusCode == 403) {
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return content;
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                return content;
            }
        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
            return null;
        }
    }

    //get POST request for all backend request with headers
    private String getPostRequest(List<NameValuePair> headers, List<NameValuePair> params, String token, String action) throws UnsupportedEncodingException {
        String content = null;
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(15*1000);
        requestBuilder.setConnectionRequestTimeout(15*1000);
        requestBuilder.setSocketTimeout(15*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s" ,authPostUrl, authPostUrlPort, action));

        if(token != null) {
            postRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        }
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");

        if(headers != null) {
            for (NameValuePair header : headers) {
                postRequest.addHeader(header.getName(), header.getValue());
            }
        }

        HttpEntity entity = new UrlEncodedFormEntity(params);
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {

                content = EntityUtils.toString(httpResponse.getEntity());

                logger.info(content);
                Gson gson = new GsonBuilder().setPrettyPrinting().create();
                JsonParser jp = new JsonParser();
                JsonElement je = jp.parse(content);
                String prettyJsonString = gson.toJson(je);

//                System.out.println(prettyJsonString);
//                System.out.println("----------------------------------------------------");

                return content;

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

    //POST Request with custom contentType
    private String getPostRequest(List<NameValuePair> headers, List<NameValuePair> params, String token, String action, String contentType) throws UnsupportedEncodingException {
        String content = null;
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(15*1000);
        requestBuilder.setConnectionRequestTimeout(15*1000);
        requestBuilder.setSocketTimeout(15*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s" ,authPostUrl, authPostUrlPort, action));

        if (token != null) {
            postRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        }
        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, contentType);

        if (headers != null){
            for(NameValuePair header: headers){
                postRequest.addHeader(header.getName(), header.getValue());
            }
        }

        if(params != null) {
            if(contentType.equals("application/json")){
                JSONObject jsonObject = new JSONObject();
                for(NameValuePair param: params){
                    if(param.getName().equals("pageNumber") || param.getName().equals("pageSize")){
                        jsonObject.put(param.getName(),Integer.parseInt(param.getValue()));
                    } else {
                        jsonObject.put(param.getName(), param.getValue());
                    }

                }
                HttpEntity entity = new StringEntity(jsonObject.toString());
                postRequest.setEntity(entity);
            }else {
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
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return null;
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
                content = EntityUtils.toString(httpResponse.getEntity());
                return content;
            }
        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
            return null;
        }

    }

    //GET Request with Bearer Token
    private String getGetRequest(List<NameValuePair> headers, String action, String token){
        String content = null;

        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10*1000);
        requestBuilder.setConnectionRequestTimeout(10*1000);
        requestBuilder.setSocketTimeout(10*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpGet getRequest = new HttpGet(String.format("http://%s:%s%s",this.authPostUrl,this.authPostUrlPort,action));

        if (token != null) {
            getRequest.addHeader(HttpHeaders.AUTHORIZATION, String.format("Bearer %s", token));
        }
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

    //get token from username and password
    public TokenKey getToken(User user, TokenKey tokenKey) throws IOException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        if (user.getEmail() == null){
            params.add(new BasicNameValuePair("username", user.getUsername()));
        }else{
            params.add(new BasicNameValuePair("username", user.getEmail()));
        }
        params.add(new BasicNameValuePair("password", user.getPassword()));

        content = checkCredentials(user.getUsername(), user.getPassword());
        if (content != null && isJson(content)) {
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.get("status").equals(200)) {
                return tokenKey;
            } else {
                return tokenKey;
            }
        }else{
            return tokenKey;
        }
    }

    //login with 2fa code
    public String getTokenMfa(User user, String code) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        if (user.getEmail() == null){
            params.add(new BasicNameValuePair("username", user.getUsername()));
        }else{
            params.add(new BasicNameValuePair("username", user.getEmail()));
        }
        params.add(new BasicNameValuePair("password", user.getPassword()));
        params.add(new BasicNameValuePair("mfaCode", code));

        content = getPostRequest(params, null, "/login/token");
        return content;
    }
    //get token from username and password
    public TokenKey getRefreshedToken(String refreshToken) throws IOException {
        String content = null;
        TokenKey tokenKey = new TokenKey();
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("refreshToken", refreshToken));

        content = getPostRequest(params, null, "/login/token/refresh");

        if (content != null){
            tokenKey = tokenKey.mapContent(content);
            tokenKey.setRequestedSystemTime(System.currentTimeMillis());
            return tokenKey;
        }
        return tokenKey;
    }

    //get user using token
    public User getUser(String token) throws IOException {
        String content = null;
        User user = new User();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("token", token));

        content = getGetRequest(null,"/setting/userinfo", token);
        if (content != null){
            user = user.mapContent(content);
            return user;
        }
        return user;
    }

    //Change Password After Recovery Password Email Link is Clicked
    public String changePassword(String token, String email, String password) throws IOException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("email", email));
        params.add(new BasicNameValuePair("password", password));
        params.add(new BasicNameValuePair("token", token));

        content = getPostRequest(params, null, "/login/recovery/password");

        JSONObject jsonObject = new JSONObject(content);
        if(jsonObject.has("status")){
            return String.valueOf(jsonObject.get("status"));
        }
        return content;
    }

    //send password recovery email
    public String passwordRecovery(String email) throws IOException {

        String content = null;
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("email", email));

        content = getPostRequest(params, null, "/login/recovery/send");
        JSONObject jsonObject = new JSONObject(content);
        if(jsonObject.has("status")){
            return String.valueOf(jsonObject.get("status"));
        }
        return content;
    }

    //reset password request
    public String resetPassword(String token, User user, String curr_password, String new_password) throws IOException {

        String content = null;

        List<NameValuePair> params = new ArrayList<>();

        params.add(new BasicNameValuePair("username", user.getUsername()));
        params.add(new BasicNameValuePair("password", new_password));
        params.add(new BasicNameValuePair("old_password", curr_password));

        content = getPostRequest(params, token, "/login/password/update");

        return content;
    }

    //get user information from token
    public User updateAccount(User user, String token) throws IOException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();

        params.add(new BasicNameValuePair("username", user.getUsername()));
        params.add(new BasicNameValuePair("email", user.getEmail()));
        params.add(new BasicNameValuePair("firstname", user.getFirstName()));
        params.add(new BasicNameValuePair("lastname", user.getLastName()));
        params.add(new BasicNameValuePair("phone", user.getPhone()));
        params.add(new BasicNameValuePair("fa2", String.valueOf(user.isFa2())));
        params.add(new BasicNameValuePair("receivenews", String.valueOf(user.isReceiveNews())));

        content = getPostRequest(params, token, "/setting/userinfo/update");

        if(content != null){
            user = user.mapContent(content);
            return user;
        }
        return user;
    }

    //confirm account given token
    public User confirmAccount(String token) throws IOException, URISyntaxException {

        String content = null;
        User user = new User();

        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpGet getRequest = new HttpGet(String.format("http://%s:%s/login/confirm-account?token=%s",this.authPostUrl,this.authPostUrlPort,token));

        try (CloseableHttpResponse httpResponse = client.execute(getRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
//                logger.info(content);
                user = user.mapContent(content);
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
//            e.printStackTrace();
        }

        return user;

    }

    //get secret for user
    public String getF2aSecret(String email, String token) throws UnsupportedEncodingException {

        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("token", token));

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("email", email));

        content = getPostRequest(headers, params, token, "/login/f2a-secret/get");

        if(content != null){
            JSONObject jsonObject = new JSONObject(content);
            if(jsonObject.has("object")) {
                JSONObject jsonObject1 = new JSONObject(jsonObject.getString("object"));
                return String.valueOf(jsonObject1.get("secret"));
            }
            return content;
        }
        return content;
    }

    //set secret for user
    public String setF2aSecret(User user, String token) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> headers = new ArrayList<>();
        headers.add(new BasicNameValuePair("token", token));

        List<NameValuePair> params = new ArrayList<>();
        if(user.getEmail() != null) {
            params.add(new BasicNameValuePair("email", user.getEmail()));
        }else{
            params.add(new BasicNameValuePair("email", user.getUsername()));
        }
        params.add(new BasicNameValuePair("f2asecret", user.getFa2secret()));

        content = getPostRequest(headers, params, token, "/login/f2a-secret/save");

        return content;
    }

    //send email verification link
    public String sendVerificationEmail(String email) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("email", email));

        content = getPostRequest(params, null, "/login/verification/send");
        return content;
    }

    //check username
    public String checkUsername(String username) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("username", username));

        content = getPostRequest(params, null, "/login/username/check");
        return content;
    }

    //check email
    public String checkEmail(String email) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("email", email));

        content = getPostRequest(params, null, "/login/email/check");
        return content;
    }

    //get account info for user
    public AccountInfo getUserAccountInfo(String token) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("token", token));

        content = getPostRequest(params, token, "/account/getinfo");

        AccountInfo accountInfo = new AccountInfo();
        if (content != null){
            accountInfo = accountInfo.mapContent(content);
            return accountInfo;
        }

        return accountInfo;
    }

    //company application
    public String companyApplication(BusinessApplication businessApplication) throws UnsupportedEncodingException {

        String content = null;
        List<NameValuePair> params = new ArrayList<>();

        //validate optional fields are not blank
        String currentSolution = (currentSolution = (businessApplication.getCurrentSolution() != null && !businessApplication.getCurrentSolution().equals("")) ? businessApplication.getCurrentSolution() : "None");
        String goal = (goal = (businessApplication.getGoal() != null && !businessApplication.getGoal().equals("")) ? businessApplication.getGoal() : "None");
        String productInfo = (productInfo = (businessApplication.getProductInfo() != null && !businessApplication.getProductInfo().equals("")) ? businessApplication.getProductInfo() : "None");

        params.add(new BasicNameValuePair("companyName", businessApplication.getCompanyName()));
        params.add(new BasicNameValuePair("productInfo", productInfo));
        params.add(new BasicNameValuePair("goal", goal));
        params.add(new BasicNameValuePair("currentSolution", currentSolution));
        params.add(new BasicNameValuePair("contactName", businessApplication.getContactName()));
        params.add(new BasicNameValuePair("contactEmail", businessApplication.getContactEmail()));
        params.add(new BasicNameValuePair("contactPhone", businessApplication.getContactPhone()));
        params.add(new BasicNameValuePair("companyAddress", businessApplication.getCompanyAddress()));
        params.add(new BasicNameValuePair("countryCode", businessApplication.getCountryCode()));
        params.add(new BasicNameValuePair("zipCode", businessApplication.getZipCode()));
        params.add(new BasicNameValuePair("companyUrl", businessApplication.getCompanyUrl()));
        params.add(new BasicNameValuePair("hasKyc", String.valueOf(businessApplication.getHasKyc())));

        content = getPostRequest(null, params, null, "/api/v1/application/apply", "application/json");

        return content;
    }

    //check if token is autherized and user has email
    public User checkUser(TokenKey tokenKey) throws IOException {


        if (tokenKey == null){
            return null;
        }

        if(tokenKey.getAccess_token() == null){
            return null;
        }

        User user = getUser(tokenKey.getAccess_token());
        if (user == null || user.getEmail() == null){
            return null;
        }

        return user;
    }

    //check registration code with business registration code list
    public String checkBusinessRegistrationCode(String email, String invite_code) throws UnsupportedEncodingException {

        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("emailAddress", email));
        params.add(new BasicNameValuePair("inviteCode", invite_code));

        content = getPostRequest(null, params, null, "/api/v1/application/verify_token", "application/json");

        return content;
    }

    //get liquidity invoices
    public String getLiquidityInvoices (String token, int pageNumber, int pageSize){
        String content = "";
        String action = "/api/v1/liquidity?pageNumber="+pageNumber+"&pageSize="+pageSize+"&type=INVOICE";

        content = getGetRequest(null, action,token);
        logger.info(content);
        return content;
    }

    //user registration
    public String registerUser(User user) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("email", user.getEmail()));
        params.add(new BasicNameValuePair("username", user.getUsername()));
        params.add(new BasicNameValuePair("password", user.getPassword()));
        params.add(new BasicNameValuePair("firstname", (user.getFirstName() == null || user.getFirstName().equals("")) ? "None" : user.getFirstName()));
        params.add(new BasicNameValuePair("lastname", (user.getLastName() == null || user.getLastName().equals("")) ? "None" : user.getLastName()));
        params.add(new BasicNameValuePair("fa2", String.valueOf(user.isFa2())));

        content = getPostRequest(params, null, "/login/registration");

        return content;
    }

    //get number of registered users
    public String getNumberRegistered() {
        String content = null;

        content = getGetRequest(null, "/login/number_of_registered_users", null);

        return content;
    }

    //check login credentials
    public String checkCredentials(String username, String password) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("username", username));
        params.add(new BasicNameValuePair("password", password));

        content = getPostRequest(params, null, "/login/authorize/check_credentials");

        return content;
    }
}


