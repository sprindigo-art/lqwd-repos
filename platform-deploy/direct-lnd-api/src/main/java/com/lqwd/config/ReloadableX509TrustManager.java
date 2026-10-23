package com.lqwd.config;

import com.lqwd.service.MacaroonService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;

public class ReloadableX509TrustManager implements X509TrustManager {


    private X509TrustManager trustManager;


    private MacaroonService macaroonService;

    private String trustStorePassword;

    Logger logger = LoggerFactory.getLogger(ReloadableX509TrustManager.class);

    public ReloadableX509TrustManager(String trustStorePassword, MacaroonService macaroonService)  {
        this.macaroonService = macaroonService;
        this.trustStorePassword = trustStorePassword;
    }

    @Override
    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        trustManager.checkClientTrusted(chain, authType);
    }

    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType) {
        try {
            trustManager.checkServerTrusted(chain, authType);
        } catch (CertificateException cx) {
            logger.info("An error occurred when checking trusted server : {}", cx.getMessage());
        }
    }

    @Override
    public X509Certificate[] getAcceptedIssuers() {
        return trustManager.getAcceptedIssuers();
    }

    /**
     * Returns Sssl
     */
    public SSLContext returnSslContext(String nodeName) throws CertificateException,
            KeyStoreException, KeyManagementException, IOException, NoSuchAlgorithmException {

        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        if(nodeName.contains("_")){
            String[] nodeNameArray = nodeName.split("_");
            nodeName = nodeNameArray[0];
        }
        byte[] macaroonFile = macaroonService.getMacaroonKeyAsByte("tls.cert", nodeName,null);

        Certificate ca = cf.generateCertificate(new ByteArrayInputStream(macaroonFile));
        KeyStore kStore = KeyStore.getInstance(KeyStore.getDefaultType());

        //ensure we dod not need any  existing trustore file
        //to prevent locks while reading.
        //we can use an empty trustore and add certificate to it which is what is mostly required
        kStore.load(null, trustStorePassword.toCharArray());


        //add tls certificate to the empty trustore
        kStore.setCertificateEntry("ca", ca);
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(kStore);
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, tmf.getTrustManagers(), null);
        return sslContext;
    }

}
