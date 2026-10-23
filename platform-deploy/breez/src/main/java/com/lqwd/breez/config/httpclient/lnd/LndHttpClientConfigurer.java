package com.lqwd.breez.config.httpclient.lnd;

import com.lqwd.breez.exceptions.ApiException;
import com.lqwd.breez.httpclient.ILndClient;
import com.lqwd.breez.model.LndNodeFile;
import com.lqwd.breez.repository.LndFileRepository;
import okhttp3.OkHttpClient;
import org.apache.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import retrofit2.Retrofit;
import retrofit2.converter.jackson.JacksonConverterFactory;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.util.Optional;

@Component
public class LndHttpClientConfigurer {

    @Autowired
    LndFileRepository lndFileRepository;

    @Value("${app.truststore.password}")
    private String trustStorePassword;

    @Value("${app.truststore.location}")
    private String trustStoreLocation;

    @Value("${app.lnd.location}")
    private String baseUrl;

    @Value("${app.lnd.file_encodes_key_path}")
    private String secretKeyPath;


    /**
     * Configures ssl certificates used for  lnd http requests.
     */
    private SSLSocketFactory returnSslSocketFactory(String nodeName) throws CertificateException, KeyStoreException, KeyManagementException, IOException, NoSuchAlgorithmException {

        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        Optional<LndNodeFile> lndNodeFile = lndFileRepository.findByFilenameAndNodeName("/data/v3/"+nodeName+"/tls.cert",nodeName);
        if(lndNodeFile.isPresent()){
            System.out.println("tls file is " + lndNodeFile.get().getFilename());
            Certificate ca = cf.generateCertificate(new ByteArrayInputStream(lndNodeFile.get().getSfile()));

            KeyStore kStore = KeyStore.getInstance(KeyStore.getDefaultType());
            kStore.load(new FileInputStream(trustStoreLocation), trustStorePassword.toCharArray());
            kStore.setCertificateEntry("ca", ca);
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(kStore);
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, tmf.getTrustManagers(), null);
            return sslContext.getSocketFactory();
        }else{
            return null;
        }
    }

    /**
     * Creates and returns Interceptor Implementation for lnd http request
     */
    private LndHttpInterceptor returnHttpInterceptor(String nodeName){
        LndHttpInterceptor interceptor = new LndHttpInterceptor(lndFileRepository, nodeName, secretKeyPath);
        return interceptor;
    }

    /**
     * Configures And build Retrofit client to be used for lnd http requests.
     * @param lndNodeName
     * @return
     */
    public ILndClient returnLndClient(String lndNodeName)  {
        try {
            OkHttpClient.Builder httpClient = new OkHttpClient
                    .Builder()
                    .addInterceptor(returnHttpInterceptor(lndNodeName))
                    .sslSocketFactory(returnSslSocketFactory(lndNodeName));

            Retrofit retrofit = new Retrofit.Builder()
                    .baseUrl(baseUrl)
                    .addConverterFactory(JacksonConverterFactory.create())
                    .client(httpClient.build())
                    .build();

            ILndClient lndClient = retrofit.create(ILndClient.class);
            return lndClient;
        }catch (CertificateException ex) {
            ex.printStackTrace();
            throw new ApiException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        } catch (KeyStoreException ex) {
            ex.printStackTrace();
            throw new ApiException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        } catch (NoSuchAlgorithmException ex) {
            ex.printStackTrace();
            throw new ApiException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        } catch (KeyManagementException ex) {
            ex.printStackTrace();
            throw new ApiException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        } catch (IOException ex) {
            ex.printStackTrace();
            throw new ApiException(HttpStatus.SC_INTERNAL_SERVER_ERROR, ex.getMessage() != null? ex.getMessage() : "Unknown error");
        }
    }
}
