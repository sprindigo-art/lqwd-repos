package com.lqwd.config;

import com.google.gson.Gson;
import com.lqwd.model.entity.CipherMethod;
import com.lqwd.model.tink.Key;
import com.lqwd.model.tink.KeyData;
import com.lqwd.model.tink.TinkSecret;
import com.lqwd.repository.CipherMethodRepository;
//import org.codehaus.jackson.map.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.io.IOException;
import java.util.*;

/**
 * Initialize the Cipher Engines
 * Ensure Existing files are properly upgraded to use AEAD cipher engine for decryption and
 * encryption, whilst using the appropriate secret key value from different environment
 *
 */
@Component
public class InitDefaultCipherEngine {
    public static final Logger logger = LoggerFactory.getLogger(InitDefaultCipherEngine.class);

    @Value("${app.encrypt_secret}")
    String encryptSecret;

    @Autowired
    CipherMethodRepository cipherMethodRepository;

    @PostConstruct
    public void init() throws IOException {
        logger.info("initialize aead cipher engine");
        String defaultMethodName = cipherMethodRepository.loadDefaultMethodName();
        if(defaultMethodName == null || defaultMethodName.trim().isEmpty()){

            TinkSecret tinkSecret = new TinkSecret();
            tinkSecret.setPrimaryKeyId(550027630);

            Key secretKey = new Key();
            KeyData keyData = new KeyData();
            keyData.setTypeUrl("type.googleapis.com/google.crypto.tink.AesGcmKey");
            keyData.setValue(encryptSecret);
            keyData.setKeyMaterialType("SYMMETRIC");

            secretKey.setKeyData(keyData);
            secretKey.setStatus("ENABLED");
            secretKey.setKeyId(550027630);
            secretKey.setOutputPrefixType("TINK");


            tinkSecret.setKey(Arrays.asList(secretKey));

            String tinkSecretAsJson = new Gson().toJson(tinkSecret);
            System.out.println(tinkSecretAsJson);


            cipherMethodRepository.setAEADDefault();
            CipherMethod method = cipherMethodRepository.findByName("AEAD").orElse(null);
            String base64EncodedSecret = Base64.getEncoder().encodeToString(tinkSecretAsJson.getBytes());
            method.setSecretKey(base64EncodedSecret);
            cipherMethodRepository.save(method);

        }else{
            logger.info("aead cipher engine already initialised. Exiting now");
        }

    }

}
