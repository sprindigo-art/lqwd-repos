package com.lqwd.config;

import com.lqwd.service.MacaroonService;
import org.springframework.beans.factory.annotation.Autowired;

import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import java.io.*;
import java.security.KeyStoreException;
import java.security.cert.Certificate;

import java.security.KeyStore;
import java.security.NoSuchAlgorithmException;

import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.UUID;

public class ReloadableX509TrustManager implements X509TrustManager {

    private static final java.util.UUID UUID = java.util.UUID.randomUUID();

    private String trustStorePath;

    private X509TrustManager trustManager;

    private ArrayList<Certificate> certList;

    private MacaroonService macaroonService;

    private String tlsFolder;

    private String trustStorePassword;

    public ReloadableX509TrustManager(String tlsFolder, String trustStorePassword, MacaroonService macaroonService) throws Exception {
         certList = new ArrayList<Certificate>();
        this.macaroonService = macaroonService;
        this.tlsFolder = tlsFolder;
        this.trustStorePath = this.tlsFolder+"server.truststore";
        this.trustStorePassword = trustStorePassword;
    }

    @Override
    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        trustManager.checkClientTrusted(chain, authType);
    }

    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
        try {
            trustManager.checkServerTrusted(chain, authType);
        } catch (CertificateException cx) {
            // Development logic only. Trusts the incoming untrusted certificate.
            // addCertificate(chain[0]);
            // reloadTrustManager();
            // trustManager.checkServerTrusted(chain, authType);
        }
    }

    @Override
    public X509Certificate[] getAcceptedIssuers() {
        return trustManager.getAcceptedIssuers();
    }

    /**
     * Instantiates a new X509TrustManager with the latest certificates
     */

    private void reloadTrustManager(String[] tlnd) throws Exception {

        // load keystore from specified cert store (or default)
//        Process process = Runtime.getRuntime().exec("keytool -import -alias tlnd4 -file c:/hp/tls4.cert -storetype JKS -keystore server.truststore");
//        OutputStream sprocess = process.getOutputStream();
 //       String tlnd[]={"tlnd2", "tlnd3", "tlnd4"};
        for(String tl: tlnd) {
            String ftlnd=this.macaroonService.saveTlsfile("/data/v3/"+tl+"/tls.cert",tl);
            try {
                String line;
                Process p = Runtime.getRuntime().exec("keytool -delete -alias at"+tl+" -keystore " + trustStorePath + " -storetype JKS -storepass aziz20 -noprompt");
                BufferedReader bri = new BufferedReader
                        (new InputStreamReader(p.getInputStream()));
                BufferedReader bre = new BufferedReader
                        (new InputStreamReader(p.getErrorStream()));
                while ((line = bri.readLine()) != null) {
                    System.out.println(line);
                }
                bri.close();
                while ((line = bre.readLine()) != null) {
                    System.out.println(line);
                }
                bre.close();
                p.waitFor();
                System.out.println("Done.");

            } catch (Exception err) {
                err.printStackTrace();
            }
            try {
                String line;
                Process p = Runtime.getRuntime().exec("keytool -import -alias at"+tl+" -file tls.cert -storetype JKS -keystore " + trustStorePath + " -storepass aziz20 -noprompt");
                BufferedReader bri = new BufferedReader
                        (new InputStreamReader(p.getInputStream()));
                BufferedReader bre = new BufferedReader
                        (new InputStreamReader(p.getErrorStream()));
                while ((line = bri.readLine()) != null) {
                    System.out.println(line);
                }
                bri.close();
                while ((line = bre.readLine()) != null) {
                    System.out.println(line);
                }
                bre.close();
                p.waitFor();
                System.out.println("Done.");

            } catch (Exception err) {
                err.printStackTrace();
            }
        }


        KeyStore ts = KeyStore.getInstance(KeyStore.getDefaultType());
        InputStream in = new FileInputStream(trustStorePath);
        try {
            ts.load(in, null);
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            in.close();
        }

        // Add queued certificates to the keystore
        for (Certificate cert : certList) {
            ts.setCertificateEntry(java.util.UUID.randomUUID().toString(), cert);
        }

        // Initialize a new TrustManagerFactory with the truststore we created
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ts);

        // Get the X509TrustManager from the Factory.
        TrustManager tms[] = tmf.getTrustManagers();
        for (int i = 0; i < tms.length; i++) {
            if (tms[i] instanceof X509TrustManager) {
                trustManager = (X509TrustManager) tms[i];
                return;
            }
        }

        throw new NoSuchAlgorithmException("No X509TrustManager in TrustManagerFactory");
    }

    /**
     * Adds cert to the TrustManager. Automatically reloads the TrustManager
     * @param cert is not null
     * @throws Exception if cannot be reloaded
     */
    private void addCertificate(Certificate cert, String tlnd) throws Exception {
        certList.add(cert);
        String[] stlnd={tlnd};
        reloadTrustManager(stlnd);
    }

    /**
     * Removes a certificate from the pending list. Automatically reloads the TrustManager
     * @param cert is not null and was already added
     * @throws Exception if cannot be reloaded
     */
    public void removeCertificate(Certificate cert, String tlnd) throws Exception {
        certList.remove(cert);
        String[] stlnd={tlnd};
        reloadTrustManager(stlnd);
    }

    /**
     * Adds a list of certificates to the manager. Automatically reloads the TrustManager
     * @param certs is not null
     * @throws Exception if cannot be reloaded
     */
    public void addCertificates(List<Certificate> certs, String[] tlnd) throws Exception {
        certList.addAll(certs);
        reloadTrustManager(tlnd);
    }

    public void reloadCertificates(String tlnd) throws Exception {

        String trustStorePath = this.tlsFolder+"server.truststore";

//        String defaultTrustStore = macaroonFile+"server.truststore";

        // Load the new Keystore and decrypt it
        KeyStore ks = KeyStore.getInstance("JKS");
        ks.load(new FileInputStream(trustStorePath), this.trustStorePassword.toCharArray());

        // Add all of the certficates in the truststore and add them to the trust manager
        Enumeration<String> enumerator = ks.aliases();
        ArrayList<Certificate> certs = new ArrayList<>();
        while (enumerator.hasMoreElements()) {
            String currentAlias = enumerator.nextElement();
            certs.add(ks.getCertificate(currentAlias));
        }
        String[] stlnd={tlnd};
        this.addCertificates(certs, stlnd);

        System.setProperty ("javax.net.ssl.trustStore", this.tlsFolder+"server.truststore");
        System.setProperty ("javax.net.ssl.trustStorePassword", "aziz20");

    }
}
