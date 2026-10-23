package com.lqwd.httpclient;

import com.google.gson.Gson;
import com.lqwd.config.ReloadableX509TrustManager;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.exceptions.LndConnectionException;
import com.lqwd.exceptions.LndException;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.service.MacaroonService;
import com.lqwd.utils.LndUtil;
import com.lqwd.validators.LndRequestValidator;
import lombok.RequiredArgsConstructor;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpDelete;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Component;

import javax.net.ssl.SSLContext;
import java.io.IOException;
import java.security.KeyManagementException;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;
import java.util.Map;
import java.util.Optional;

@RefreshScope
@Component
@RequiredArgsConstructor
public class LndHttpClient {


    @Value("${app.lnd_rpc_port}")
    private String lndPort;

    @Value("${app.location}")
    private String appLocation;

    @Value("${app.truststore.password}")
    private String trustStorePassword;


    private final static Logger logger = LoggerFactory.getLogger(LndHttpClient.class);


    private final MacaroonService macaroonService;

    private final LndRequestValidator lndRequestValidator;

    private SSLContext loadSSLContext(String lndNodeName){
        ReloadableX509TrustManager trustManager = getReloadableX509TrustManager();
        SSLContext sslContext = null;
        try {
            sslContext = trustManager.returnSslContext(lndNodeName);
        } catch (CertificateException e) {
            e.printStackTrace();
        } catch (KeyStoreException e) {
            e.printStackTrace();
        } catch (KeyManagementException e) {
            e.printStackTrace();
        } catch (IOException e) {
            e.printStackTrace();
        } catch (NoSuchAlgorithmException e) {
            e.printStackTrace();
        }
        return sslContext;
    }


    private ReloadableX509TrustManager getReloadableX509TrustManager() {
        return new ReloadableX509TrustManager(trustStorePassword, macaroonService);
    }

    public LNDResponse deleteRequestToLndPod(String command, String nodeAddress,
                                             Optional<Map<String, Object>> values, String lndNodeName,
                                             String lndPassphrase) throws Exception {

        SSLContext sslContext = loadSSLContext(lndNodeName);

        if(sslContext == null)
            throw new Exception("Error Setting trust manager");


        CloseableHttpClient client = HttpClients.custom()
                .setSSLContext(sslContext)
                .build();


        String macaroonFile = LndUtil.getMacaroonFile(command, "DELETE");
        String encryptionPassword = LndUtil
                .requiresAdminMacaroon(command, "DELETE") ? lndPassphrase : null;

        logger.info("Debugging about to get macarooon file via cipher service "+macaroonFile);

        String macaroonString = macaroonService.getMacaroonKey(macaroonFile, lndNodeName,encryptionPassword);

        String url = appLocation.equals("localhost") ? "localhost": nodeAddress;
        String commandUrl = String.format("https://%s:8080/%s", url,command);

        URIBuilder builder = new URIBuilder(commandUrl);

        if(values.isPresent()) {
            for(Map.Entry<String,Object> entry : values.get().entrySet()) {
                builder.setParameter(entry.getKey(), entry.getValue()+"");
            }
        }

        HttpDelete deleteRequest = new HttpDelete(builder.build());
        deleteRequest.setHeader("Grpc-Metadata-macaroon", macaroonString);


        try (CloseableHttpResponse httpResponse = client.execute(deleteRequest)) {
            int statusCode = httpResponse.getStatusLine().getStatusCode();
            String content = EntityUtils.toString(httpResponse.getEntity());
            if (statusCode != 200) {
                logger.info("Lnd delete request failed, url: {} , status: {} {}", commandUrl, statusCode
                        , content);
                throw new LndException(content);
            }
            return LNDResponse.builder().response(content).status(statusCode)
                    .build();
        } catch (IOException e) {

            logger.info("An exception occurred while running delete request: {}, exception: {}", commandUrl,
                    e.getMessage());
            throw new LndConnectionException("An error occurred when communicating with lnd node");
        }

    }



    public LNDResponse getRequestToLndPod(String path, String nodeAddress, Optional<Map<String, Object>> values,
                                          String lndNodeName, String lndPassphrase) throws Exception {

        SSLContext sslContext = loadSSLContext(lndNodeName);

        if(sslContext == null){
            throw new Exception("Error Setting trust manager");
        }

        String macaroonFile = LndUtil.getMacaroonFile(path, "GET");
        String encryptionPassword = LndUtil
                .requiresAdminMacaroon(path,"GET") ? lndPassphrase : null;

        String macaroonString = macaroonService.getMacaroonKey(macaroonFile,
                lndNodeName, encryptionPassword);

        String url = appLocation.equals("localhost") ? "localhost" : nodeAddress;

        String commandUrl = String.format("https://%s:%s/%s", url, lndPort, path);

        URIBuilder builder = new URIBuilder(commandUrl);

        if(values.isPresent()) {
            for(Map.Entry<String,Object> entry : values.get().entrySet()) {
                builder.setParameter(entry.getKey(), entry.getValue()+"");
            }
        }

        HttpGet getRequest = new HttpGet(builder.build());
        getRequest.setHeader("Grpc-Metadata-macaroon", macaroonString);

        CloseableHttpClient client = HttpClients.custom()
                .setSSLContext(sslContext)
                .build();

        try (CloseableHttpResponse httpResponse = client.execute(getRequest)) {

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            String content = EntityUtils.toString(httpResponse.getEntity());
            if(statusCode != 200) {
                logger.info("Lnd get request failed, url: {} , status: {}", commandUrl, statusCode);

                throw new LndException(content);
            }
            return LNDResponse.builder().response(content)
                            .status(statusCode).build();


        } catch (IOException e) {

            logger.info("An exception occurred while running get request: {}, exception: {}", commandUrl,
                    e.getMessage());
            logger.info(e.getMessage());
            if(e.getMessage().contains("service not known")){
                logger.info(" Lnd HTTP Client  line 198 :" + e.getMessage());
                return LNDResponse.builder().response("{Name or service not known}")
                        .status(200).build();
            }
            throw new LndConnectionException("An error occurred when communicating with lnd node");
        }

    }

    public LNDResponse postRequestToLndPod(String urlPath,
                                           String nodeAddress,
                                           ContentType contentType,
                                           Optional<Map<String, Object>> data,
                                           String lndNodeName, String lndPassphrase) throws Exception {
        lndRequestValidator.validate(urlPath,data);
        SSLContext sslContext = loadSSLContext(lndNodeName);

        if(sslContext == null){
            throw new Exception("Error Setting trust manager");
        }

        CloseableHttpClient client = HttpClients.custom()
                .setSSLContext(sslContext)
                .build();


        String macaroonFile = LndUtil.getMacaroonFile(urlPath, "POST");
        String encryptionPassword = LndUtil.requiresAdminMacaroon(urlPath, "POST") ? lndPassphrase : null;
        logger.info("Debugging about to get macarooon file via cipher service "+macaroonFile);

        String macaroonString = macaroonService.getMacaroonKey(macaroonFile, lndNodeName,encryptionPassword);

        String url = appLocation.equals("localhost") ? "localhost": nodeAddress;
        String fullUrl = String.format("https://%s:%s/%s", url,lndPort,urlPath);

        HttpPost postRequest = new HttpPost(fullUrl);
        postRequest.setHeader("Grpc-Metadata-macaroon", macaroonString);
        postRequest.setHeader("Accept", "*/*");

        if (data.isPresent()) {
            String json = new Gson().toJson(data.get());

            String formatJson = json.replace("\\", "")
                    .replaceFirst("\"\\{", "\\{").replaceFirst("\\}\"", "\\}");

            logger.info("request is {}", formatJson);

            postRequest.setHeader(HttpHeaders.CONTENT_TYPE, String.valueOf(contentType));
            postRequest.setEntity(new StringEntity(formatJson));
        }

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {

            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode != 200){
                logger.info("A http error occurred on post request to lnd, status: {}", content);
                throw new LndException(content);
            }

            return LNDResponse.builder().response(content).status(statusCode).build();

        } catch (IOException e) {
            logger.info("An exception occurred when sending post request: {}",e.getMessage());
            throw new LndConnectionException("An error occurred when communicating with lnd node");
        }
    }
}
