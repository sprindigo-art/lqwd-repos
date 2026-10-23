package com.lqwd.service;


import com.amazonaws.util.IOUtils;
import com.google.gson.Gson;
import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailAttachment;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.model.F2aSecret;
import com.lqwd.model.User;
import com.lqwd.model.request.InvoiceToEmailRequest;
import com.lqwd.model.request.RegistrationRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.HttpStatus;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.UnsupportedEncodingException;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@RefreshScope
@Service("userService")
@RequiredArgsConstructor
public class UserService {


    private final AppProperties properties;
    private final KafkaMessageSender kafkaMessageSender;

    private static Logger logger = LoggerFactory.getLogger(UserService.class);

    private MainResponse sendHttpResponse(RegistrationRequest registrationRequest,
                                          String actionPath) throws UnsupportedEncodingException {

        CloseableHttpClient client = HttpClientBuilder.create().build();
        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/json");

        registrationRequest.setServiceName(properties.getAuth_user_name());

        Gson gson = new Gson();

        StringEntity postingString = new StringEntity(gson.toJson(registrationRequest));
        postRequest.setEntity(postingString);

        return getMainResponseFromRequest(client, postRequest);
    }



    public MainResponse saveUser(RegistrationRequest request) throws UnsupportedEncodingException {

        String actionPath = "/registration/v2";
        request.setServiceName(properties.getAuth_user_name());
        return this.sendHttpResponse(request,actionPath);

    }

    public MainResponse sendVerification(String username) throws UnsupportedEncodingException {

        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + "/registration/verification/send");

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/x-www-form-urlencoded");


        List<NameValuePair> param = new ArrayList<>();
        param.add(new BasicNameValuePair("username", username));

        postRequest.setEntity(new UrlEncodedFormEntity(param, "UTF-8"));

        return getMainResponseFromRequest(client, postRequest);


    }

    public MainResponse checkCredentials(String username, String password) throws UnsupportedEncodingException {

        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + "/authorize/check_credentials");

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/x-www-form-urlencoded");


        List<NameValuePair> param = new ArrayList<>();
        param.add(new BasicNameValuePair("username", username));
        param.add(new BasicNameValuePair("password", password));

        postRequest.setEntity(new UrlEncodedFormEntity(param, "UTF-8"));

        return getMainResponseFromRequest(client, postRequest);


    }

    private MainResponse getMainResponseFromRequest(CloseableHttpClient client,  HttpPost postRequest) {
        MainResponse mainResponse = new MainResponse();
        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode == 200) {
                mainResponse.setClass_name("User");
                mainResponse.setObject(content);
                mainResponse.setStatus(statusCode);
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
        }
        return mainResponse;
    }

    public ApiResponse<Long> getNumberOfRegisteredUsers() {

        CloseableHttpClient client = HttpClientBuilder.create().build();
        HttpGet getRequest = new HttpGet("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + "/registration/number_of_registration");

        getRequest.setHeader("Content-type", "application/x-www-form-urlencoded");

        try(CloseableHttpResponse getResponse = client.execute(getRequest)) {
            String content = EntityUtils.toString(getResponse.getEntity());

            int statusCode = getResponse.getStatusLine().getStatusCode();

            if (statusCode == 200) {
                String allowedNumber = properties.getNumber_of_registration_users();
                long number = 0;
                try {
                    //convert string to long
                    if(allowedNumber != null && !allowedNumber.equals("")) {
                        number = Long.parseLong((allowedNumber));
                        number = number - Long.parseLong(content);
                    }
                } catch (NumberFormatException e) {
                    System.out.println(" Not a valid long value from configuration for Number of Registration users.");
                } catch (NullPointerException e) {
                    System.out.println("String is null. from configuration for Number of Registration users.");
                }


                return new ApiResponse<>(200,number,
                        "Request successful");
            }

        } catch (IOException e) {

            logger.info(e.getMessage());
        }

        return new ApiResponse<>(400,null,
                "An error occurred when getting count");

    }

    public MainResponse confirmVerification(String token) throws IOException {
        MainResponse mainResponse = new MainResponse();
        String actionPath = "/registration/confirm-account";
        CloseableHttpClient client = HttpClientBuilder.create().build();
        HttpGet getRequest = new HttpGet("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + actionPath +"?token="+token);


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

    public MainResponse recoverySend(String identity) throws UnsupportedEncodingException {

        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + "/registration/password-recovery");

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/x-www-form-urlencoded");


        List<NameValuePair> param = new ArrayList<>();
        param.add(new BasicNameValuePair("email", identity));

        postRequest.setEntity(new UrlEncodedFormEntity(param, "UTF-8"));

        return getMainResponseFromRequest(client, postRequest);

    }

    public MainResponse recoveryUpdate(String confirmationToken, String password) throws UnsupportedEncodingException {

        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + "/registration/update-password");

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader("Content-type", "application/x-www-form-urlencoded");


        List<NameValuePair> param = new ArrayList<>();
        param.add(new BasicNameValuePair("token", confirmationToken));
        param.add(new BasicNameValuePair("password", password));

        postRequest.setEntity(new UrlEncodedFormEntity(param, "UTF-8"));

        return getMainResponseFromRequest(client, postRequest);
    }


    public MainResponse updatePassword(String username, String oldPassword, String password) {
        CloseableHttpClient client = HttpClientBuilder.create().build();
        MainResponse mainResponse = new MainResponse();
        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + "/registration/update/password");

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");


        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("username", new StringBody(username, ContentType.MULTIPART_FORM_DATA))
                .addPart("old_password", new StringBody(oldPassword, ContentType.MULTIPART_FORM_DATA))
                .addPart("password", new StringBody(password, ContentType.MULTIPART_FORM_DATA))
                .addPart("client_id", new StringBody(properties.getAuth_password(),
                        ContentType.MULTIPART_FORM_DATA)).build();
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
        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + actionPath);

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        HttpEntity entity = MultipartEntityBuilder
                .create()
                .addPart("username", new StringBody(f2aSecret.getEmail(), ContentType.MULTIPART_FORM_DATA))
                .addPart("f2asecret", new StringBody(f2aSecret.getF2asecret(), ContentType.MULTIPART_FORM_DATA))
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
        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + actionPath);

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
        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + actionPath);

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
        HttpPost postRequest = new HttpPost("http://" + properties.getAuth_post_url() + ":"
                + properties.getAuth_post_port() + actionPath);

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


    public ApiResponse<String> sendSubscribeRequestEmail(String email) throws IOException {

        EmailBody emailBody = new EmailBody();
        emailBody.setBody("Subscribe Request from: "+ email);
        emailBody.setSubject("Subscribe Request on LQwD.tech");

        EmailAttachment attachment = new EmailAttachment();
        attachment.setCid("0123456789");
        attachment.setMime("image/png");
        attachment.setContent("   content   ");
        attachment.setName("qrcode");
        attachment.setInline(true);

        emailBody.setAttachments(Arrays.asList(attachment));

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName("Info");
        receiver.setEmail("info@lqwd.money");
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);




        kafkaMessageSender.sendEmail(emailBody);

        return new ApiResponse<>("Subscribe Email Sent", "Request successful");
    }
}
