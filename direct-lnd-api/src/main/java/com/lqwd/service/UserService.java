package com.lqwd.service;


import com.google.gson.Gson;
import com.lqwd.model.CommandHistory;
import com.lqwd.model.F2aSecret;
import com.lqwd.model.request.RegistrationRequest;
import com.lqwd.model.User;
import com.lqwd.model.request.UserSetting;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.UserResponse;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;

@Service("userService")
public class UserService {

    @Value("${app.auth_post_url}")
    private String appAuthPostUrl;

    @Value("${app.auth_password}")
    private String appAuthPassword;

    @Value("${app.auth_user_name}")
    private String appAuthUserName;

    @Value("${app.auth_post_port}")
    private String appAuthPostPort;

//    @Value("${app.auth_client_id}")
//    private String appAuthClientId;

    private static Logger logger = LoggerFactory.getLogger(UserService.class);

    private MainResponse sendHttpResponse(User user, String actionPath) throws UnsupportedEncodingException {
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/json");

        RegistrationRequest registrationRequest = new RegistrationRequest();


        registrationRequest.setLastname(user.getLastname());
        registrationRequest.setFirstname(user.getFirstname());
        registrationRequest.setUsername(user.getUsernameOrEmail());
        registrationRequest.setEmail(user.getEmail());
        registrationRequest.setPassword(user.getPassword());
        registrationRequest.setF2a(user.getF2a());
        registrationRequest.setServiceName(this.appAuthUserName);

        Gson gson = new Gson();

        StringEntity postingString = new StringEntity(gson.toJson(registrationRequest));//gson.tojson() converts your pojo to json
        postRequest.setEntity(postingString);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            } else {
                mainResponse.setStatus(statusCode);
                mainResponse.setError(content);
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }



    public MainResponse saveUser(User user) throws UnsupportedEncodingException {

        String actionPath = "/registration/v2";
        return this.sendHttpResponse(user,actionPath);

    }

    public MainResponse sendVerification(User user) throws UnsupportedEncodingException {
        String actionPath = "/registration/verification/send";
        return this.sendHttpResponse(user,actionPath);

    }
    public MainResponse confirmVerification(String token) throws IOException {
        MainResponse mainResponse = new MainResponse();
        String actionPath = "/registration/confirm-account";
        CloseableHttpClient client = HttpClientBuilder.create().build();
        HttpGet getRequest = new HttpGet("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath +"?token="+token);


        getRequest.setHeader("Accept", "*/*");
        getRequest.setHeader("Content-type", "application/x-www-form-urlencoded");
        try(CloseableHttpResponse getResponse = client.execute(getRequest)) {
            String content = EntityUtils.toString(getResponse.getEntity());

            int statusCode = getResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            } else
                mainResponse.setStatus(statusCode);
                mainResponse.setError(content);
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;

    }

    public MainResponse recoverySend(User user) throws IOException {
        MainResponse mainResponse = new MainResponse();
        String actionPath = "/registration/password-recovery";
        CloseableHttpClient client = HttpClientBuilder.create().build();
        HttpGet getRequest = new HttpGet("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath + "?email=" + user.getEmail());


        getRequest.setHeader("Accept", "*/*");
        getRequest.setHeader("Content-type", "application/x-www-form-urlencoded");
        try (CloseableHttpResponse getResponse = client.execute(getRequest)) {
            String content = EntityUtils.toString(getResponse.getEntity());

            int statusCode = getResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            } else
                mainResponse.setStatus(statusCode);
            mainResponse.setError(content);
            logger.info("statusCode = " + statusCode);
            logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }

    public MainResponse recoveryUpdate(User user) throws UnsupportedEncodingException {
        String actionPath = "/registration/update-password";
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");


        HttpEntity entity = MultipartEntityBuilder
                .create()
                //.addPart("username", new StringBody(user.getEmail(), ContentType.MULTIPART_FORM_DATA))
                .addPart("token1", new StringBody(user.getToken(), ContentType.MULTIPART_FORM_DATA))
                .addPart("passwordn", new StringBody(user.getPassword(), ContentType.MULTIPART_FORM_DATA))
               // .addPart("client_id", new StringBody(this.appAuthPassword, ContentType.MULTIPART_FORM_DATA))
                .build();
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            }
            mainResponse.setStatus(statusCode);
            mainResponse.setError(content);
            logger.info("statusCode = " + statusCode);
            logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }


    public MainResponse updatePassword(String username, String oldPassword, String password) {
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + "/registration/update/password");

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");


        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("username", new StringBody(username, ContentType.MULTIPART_FORM_DATA))
                .addPart("old_password", new StringBody(oldPassword, ContentType.MULTIPART_FORM_DATA))
                .addPart("password", new StringBody(password, ContentType.MULTIPART_FORM_DATA))
                .addPart("client_id", new StringBody(this.appAuthPassword, ContentType.MULTIPART_FORM_DATA)).build();
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            }
            mainResponse.setStatus(statusCode);
            mainResponse.setError(content);
            logger.info("statusCode = " + statusCode);
            logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }

    public MainResponse saveSecret(F2aSecret f2aSecret, String action) {

        String actionPath = "/registration/f2a/"+action;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("username", new StringBody(f2aSecret.getEmail(), ContentType.MULTIPART_FORM_DATA))
                .addPart("f2asecret", new StringBody(f2aSecret.getF2asecret(), ContentType.MULTIPART_FORM_DATA))
               // .addPart("client_id", new StringBody(this.appAuthPassword, ContentType.MULTIPART_FORM_DATA))
                .build();
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("F2aSecret");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            }
            mainResponse.setStatus(statusCode);
            mainResponse.setError(content);
            logger.info("statusCode = " + statusCode);
            logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }

    public MainResponse getSecret(F2aSecret f2aSecret, String action) {

        String actionPath = "/registration/f2a/"+action;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("username", new StringBody(f2aSecret.getEmail(), ContentType.MULTIPART_FORM_DATA))
                .build();
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("F2aSecret");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            }
            mainResponse.setStatus(statusCode);
            mainResponse.setError(content);
            logger.info("statusCode = " + statusCode);
            logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }

    public MainResponse checkUsername(String username, String action) {

        String actionPath = "/registration/"+action;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("username", new StringBody(username, ContentType.MULTIPART_FORM_DATA))
                .build();
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            }
            mainResponse.setStatus(statusCode);
            mainResponse.setError(content);
            logger.info("statusCode = " + statusCode);
            logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }

    public MainResponse checkEmail(String username, String action) {

        String actionPath = "/registration/"+action;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + this.appAuthPostUrl + ":"
                + this.appAuthPostPort + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("email", new StringBody(username, ContentType.MULTIPART_FORM_DATA))
                .build();
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
                return mainResponse;
            }
            mainResponse.setStatus(statusCode);
            mainResponse.setError(content);
            logger.info("statusCode = " + statusCode);
            logger.info("content = " + content);

        } catch (IOException e) {
            // handle exception
            mainResponse.setStatus(500);
            mainResponse.setError(e.getMessage());
            logger.info(e.getMessage());
            e.printStackTrace();
        }

        return mainResponse;
    }


}
