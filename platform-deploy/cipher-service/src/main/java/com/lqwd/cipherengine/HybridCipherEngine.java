package com.lqwd.cipherengine;

import com.google.crypto.tink.*;
import com.google.crypto.tink.hybrid.HybridConfig;
import com.google.crypto.tink.hybrid.HybridKeyTemplates;
import com.lqwd.interfaces.CipherEngine;
import com.lqwd.model.entity.CipherMethod;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.Base64;



/**
 * @author Olufemi Thompson
 * Hybrid Encryption/Decryption Engine
 */
@Component("HYBRID")
public class HybridCipherEngine extends BaseCipherEngineComponent implements CipherEngine {

    @Override
    public String encrypt(String input, String secretKey, String password) throws GeneralSecurityException, IOException {
        HybridConfig.register();

        //Get private keyset handle
        KeysetHandle privateKeysetHandle = secretKey == null? getPrivateKeysetHandle(): getPrivateKeysetHandle(secretKey);

        //Obtain the public key material.
        KeysetHandle publicKeysetHandle =
                privateKeysetHandle.getPublicKeysetHandle();

        //Get the primitive.
        HybridEncrypt hybridEncrypt =
                publicKeysetHandle.getPrimitive(HybridEncrypt.class);


        //Run encryption
        byte[] encrypted = hybridEncrypt.encrypt(Base64.getDecoder().decode(input), password != null?password.getBytes():  associatedData.getBytes());
        return Base64.getEncoder().encodeToString(encrypted);
    }

    public String loadAssoicated(){
        return associatedData;
    }

    public String loadKey(){
        CipherMethod cipherMethod = getCipherMethod();
        return cipherMethod.getSecretKey();
    }


    @Override
    public String decrypt(String input, String secretKey, String password) throws GeneralSecurityException, IOException {
        HybridConfig.register();
        //Get private keyset handle
        KeysetHandle privateKeysetHandle = secretKey == null? getPrivateKeysetHandle(): getPrivateKeysetHandle(secretKey);

        //Get the primitive
        HybridDecrypt hybridDecrypt = privateKeysetHandle.getPrimitive(HybridDecrypt.class);

        //Use the primitive for decryption
        byte[] decrypted = hybridDecrypt.decrypt(Base64.getDecoder().decode(input), password != null?password.getBytes(): associatedData.getBytes());
        return Base64.getEncoder().encodeToString(decrypted);
    }

    @Override
    public String generateKey() throws GeneralSecurityException, IOException {

        HybridConfig.register();
        KeysetHandle keysetHandle = KeysetHandle.generateNew(
                HybridKeyTemplates.ECIES_P256_HKDF_HMAC_SHA256_AES128_GCM);


        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        CleartextKeysetHandle.write(keysetHandle, JsonKeysetWriter.withOutputStream(outputStream));

        String jsonString = new String(outputStream.toByteArray());
        return jsonString;
    }
}
