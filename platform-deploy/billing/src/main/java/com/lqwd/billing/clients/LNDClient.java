package com.lqwd.billing.clients;

import com.google.gson.Gson;
import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.LNDResponse;
import lombok.RequiredArgsConstructor;
import org.apache.http.Header;
import org.apache.http.HttpHeaders;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.message.BasicHeader;
import org.apache.http.util.EntityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;


@Service
@RequiredArgsConstructor
public class LNDClient {

    private Logger logger = LoggerFactory.getLogger(LNDClient.class);

    @Value("${app.invoice-lnd.cert}")
    private String cert;
    @Value("${app.invoice-lnd.macaroon}")
    private String macaroon;
    @Value("${app.invoice-lnd.address}")
    private String lndAddress;
    @Value("${app.truststore-password}")
    private String truststorePassword;

    private SSLContext sslContext;

    private CloseableHttpClient httpclient;

    @PostConstruct
    public void init() {

        try {
            sslContext = createSslContext();
        } catch (Exception e) {
            e.printStackTrace();
        }

        List<Header> headers = new ArrayList<>();
        headers.add(new BasicHeader("Grpc-Metadata-macaroon", macaroon));
        headers.add(new BasicHeader("Accept", "*/*"));

        int timeoutMilli = 5000;
        RequestConfig config = RequestConfig.custom()
                .setConnectTimeout(timeoutMilli)
                .setConnectionRequestTimeout(timeoutMilli)
                .setSocketTimeout(timeoutMilli).build();

        this.httpclient = HttpClientBuilder.create()
                .setDefaultRequestConfig(config)
                .setSSLContext(sslContext)
                .setDefaultHeaders(headers)
                .build();

    }

    public SSLContext createSslContext() throws CertificateException,
            KeyStoreException, KeyManagementException, IOException, NoSuchAlgorithmException {

        CertificateFactory cf = CertificateFactory.getInstance("X.509");

        Certificate ca = cf.generateCertificate(new ByteArrayInputStream(Base64.getDecoder().decode(cert)));
        KeyStore kStore = KeyStore.getInstance(KeyStore.getDefaultType());

        //ensure we dod not need any  existing trustore file
        kStore.load(null, truststorePassword.toCharArray());


        //add tls certificate to the empty trustore
        kStore.setCertificateEntry("ca", ca);
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(kStore);


        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, tmf.getTrustManagers(), null);
        return sslContext;
    }


    public LNDResponse postToLND(String urlPath, ContentType contentType,
                                 Optional<Map<String, Object>> data) throws Exception {



        String fullUrl = String.format("%s/%s", lndAddress, urlPath);

        HttpPost postRequest = new HttpPost(fullUrl);

        if (data.isPresent()) {
            String json = new Gson().toJson(data.get());

            String formatJson = json.replace("\\", "")
                    .replaceFirst("\"\\{", "\\{").replaceFirst("\\}\"", "\\}");

            logger.info("request is {}", formatJson);

            postRequest.setHeader(HttpHeaders.CONTENT_TYPE, String.valueOf(contentType));
            postRequest.setEntity(new StringEntity(formatJson));

        }

        try (CloseableHttpResponse httpResponse = this.httpclient.execute(postRequest)) {

            String content = EntityUtils.toString(httpResponse.getEntity());

            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode != 200){
                logger.info("A http error occurred on post request to lnd, status: {}", content);
                throw new BadRequestException(statusCode, content);
            }

            return LNDResponse.builder().response(content).status(statusCode).build();

        } catch (IOException e) {

            logger.info("An exception occurred when sending post request: {}",e.getMessage());
            throw new BadRequestException(500,
                    "An error occurred when communicating with lnd node");

        }

    }

    public LNDResponse getRequestToLndPod(String path, Optional<Map<String, Object>> values) throws Exception {


        String fullUrl = String.format("%s/%s", lndAddress, path);
        URIBuilder builder = new URIBuilder(fullUrl);

        if(values.isPresent()) {
            for(Map.Entry<String,Object> entry : values.get().entrySet()) {
                builder.setParameter(entry.getKey(), entry.getValue()+"");
            }
        }

        HttpGet getRequest = new HttpGet(builder.build());

        try (CloseableHttpResponse httpResponse = this.httpclient.execute(getRequest)) {

            int statusCode = httpResponse.getStatusLine().getStatusCode();
            String content = EntityUtils.toString(httpResponse.getEntity());

            if(statusCode != 200) {
                logger.info("Lnd get request failed, url: {} , status: {}", fullUrl,
                        statusCode);
                throw new BadRequestException(statusCode, content);
            }


            return LNDResponse.builder().response(content)
                    .status(statusCode).build();


        } catch (IOException e) {

            logger.info("An exception occurred while running get request: {}, exception: {}", fullUrl,
                    e.getMessage());

            throw new BadRequestException(500,
                    "An error occurred when communicating with lnd node");        }

    }


}
