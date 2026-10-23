package com.lqwd.httpclient;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.lqwd.config.ReloadableX509TrustManager;
import com.lqwd.model.response.LndResponse;
import com.lqwd.service.MacaroonService;
import org.apache.http.HttpResponse;
import org.apache.http.client.HttpClient;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpDelete;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.conn.ssl.DefaultHostnameVerifier;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.util.EntityUtils;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.MultiValueMap;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.util.*;

@Component
public class LndHttpClient {

    @Value("${app.auth_post_url}")
    private String authPostUrl;

    @Value("${app.auth_post_port}")
    private String authPostUrlPort;

    @Value("${spring.tls.admin}")
    private String tlsFolder;

    @Value("${app.auth_user_name}")
    private String authUserName;

    @Value("${app.auth_password}")
    private String authPassword;

    @Value("${app.location}")
    private String appLocation;

    @Value("${app.truststore.password}")
    private String trustStorePassword ;

    private int numberOfConnectionRepeat =5;

    private final static Logger logger = LoggerFactory.getLogger(HttpClientToken.class);

    @Autowired
    private MacaroonService macaroonService;



    public String postRequestToLndPod(String command, Optional<MultiValueMap<String, String>> values, JSONObject jsonData) throws Exception {
        ReloadableX509TrustManager trustManager = new ReloadableX509TrustManager(tlsFolder, trustStorePassword, macaroonService);
        String lndnodename = (String) jsonData.get("lndNodeName");
        String namespace = (String) jsonData.get("namespace");
        String content = null;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        String macaroonFileName = "admin.macaroon";

        trustManager.reloadCertificates(lndnodename);

        String macaroonString = macaroonService.getMacaroonKey(macaroonFileName,lndnodename);

        String url=lndnodename+"."+namespace;
        if(appLocation.equals("localhost")) {
            url="localhost";
        }
        String commandUrl = "https://"+url+":8080/"+command;
        HttpPost postRequest = new HttpPost(commandUrl);
        postRequest.setHeader("Grpc-Metadata-macaroon", macaroonString);
        postRequest.setHeader("Accept", "*/*");
        postRequest.setHeader("Content-type", "application/x-www-form-urlencoded");

        if(values.isPresent()){
            Map<String, String> avalues = values.get().toSingleValueMap();
            ObjectMapper objectMapper = new ObjectMapper();
            String json = objectMapper.writeValueAsString(avalues);

            String jsonU = json.replace("\"true\"", "true");
            jsonU = jsonU.replace("\"false\"", "false");
            jsonU = jsonU.replace("\"{", "{");
            jsonU = jsonU.replace("}\"", "}");
            jsonU = jsonU.replace("\\", "");
            System.out.println(jsonU);
//            application/json; charset=UTF-8
            StringEntity entity = new StringEntity(jsonU,  "application/x-www-form-urlencoded", "UTF-8" );
            postRequest.setEntity(entity);
        }

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            System.out.println(content);
            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode != 200) {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            logger.info(e.getMessage());
            e.printStackTrace();
            content = e.getMessage();
        }

        return content;
    }

    public String deleteRequestToLndPod(String command, Optional<MultiValueMap<String, String>> values, JSONObject jsonData) throws Exception {
        ReloadableX509TrustManager trustManager = new ReloadableX509TrustManager(tlsFolder, trustStorePassword, macaroonService);
        String lndnodename = (String) jsonData.get("lndNodeName");
        String namespace = (String) jsonData.get("namespace");
        String content = null;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        String macaroonFileName = "admin.macaroon";

        trustManager.reloadCertificates(lndnodename);


        String macaroonString = macaroonService.getMacaroonKey(macaroonFileName,lndnodename);

        String url=lndnodename+"."+namespace;
        if(appLocation.equals("localhost")) {
            url="localhost";
        }
        String commandUrl = "https://"+url+":8080/"+command;
        HttpDelete deleteRequest = new HttpDelete(commandUrl);

        deleteRequest.setHeader("Grpc-Metadata-macaroon", macaroonString);

        try (CloseableHttpResponse httpResponse = client.execute(deleteRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode != 200) {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            logger.info(e.getMessage());
            e.printStackTrace();
            content = e.getMessage();
        }

        return content;
    }


    public String getRequestToLndPod(String command, String lndnodename, String namespace) throws Exception {

        // Initialize the new trustManager with the default trust store
        ReloadableX509TrustManager trustManager = new ReloadableX509TrustManager(tlsFolder, trustStorePassword, macaroonService);

        String content = null;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        String macaroonFileName = "admin.macaroon";

        trustManager.reloadCertificates(lndnodename);

        String port = "8080";
        String macaroonString = macaroonService.getMacaroonKey(macaroonFileName,lndnodename);

        String url=lndnodename+"."+namespace;
        if(appLocation.equals("localhost")) {
            url="localhost";
        }
        String commandUrl = "https://"+url+":"+port+"/"+command;

        HttpGet getRequest = new HttpGet(commandUrl);
        getRequest.setHeader("Grpc-Metadata-macaroon", macaroonString);

        try (CloseableHttpResponse httpResponse = client.execute(getRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            System.out.println(content);
            int statusCode = httpResponse.getStatusLine().getStatusCode();
            if (statusCode != 200) {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            logger.info(e.getMessage());
            e.printStackTrace();
            content=e.getMessage() + " -- " + commandUrl;
        }

        return content;
    }
}
