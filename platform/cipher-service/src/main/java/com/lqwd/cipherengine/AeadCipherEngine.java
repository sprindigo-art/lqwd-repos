package com.lqwd.cipherengine;

import com.google.crypto.tink.*;
import com.google.crypto.tink.aead.AeadConfig;
import com.google.crypto.tink.aead.AeadKeyTemplates;
import com.google.crypto.tink.hybrid.HybridKeyTemplates;
import com.lqwd.interfaces.CipherEngine;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.Base64;


/**
 * @author Olufemi Thompson
 * AEAD Encryption/Decryption Engine
 */
@Component("AEAD")
public class AeadCipherEngine extends BaseCipherEngineComponent implements CipherEngine {


    @Override
    public String encrypt(String input, String secretKey, String password) throws GeneralSecurityException, IOException {
        AeadConfig.register();

        //Get private keyset handle
        KeysetHandle privateKeysetHandle = secretKey == null? getPrivateKeysetHandle(): getPrivateKeysetHandle(secretKey);

        //Get the primitive
        Aead aead = privateKeysetHandle.getPrimitive(Aead.class);

        //Use the primitive for encryption
        byte[] encrypted = aead.encrypt(Base64.getDecoder().decode(input), password != null? password.getBytes():associatedData.getBytes());
        return Base64.getEncoder().encodeToString(encrypted);
    }


    @Override
    public String decrypt(String input, String secretKey, String password) throws GeneralSecurityException, IOException {
        AeadConfig.register();

        //Get private keyset handle
        KeysetHandle privateKeysetHandle = secretKey == null? getPrivateKeysetHandle(): getPrivateKeysetHandle(secretKey);

        //Get the primitive
        Aead aead = privateKeysetHandle.getPrimitive(Aead.class);

        //Use the primitive for decryption
        byte[] decrypted = aead.decrypt(Base64.getDecoder().decode(input),password != null? password.getBytes(): associatedData.getBytes());
        return Base64.getEncoder().encodeToString(decrypted);
    }

    @Override
    public String generateKey() throws GeneralSecurityException, IOException {
        AeadConfig.register();
        KeysetHandle keysetHandle = KeysetHandle.generateNew(
                AeadKeyTemplates.AES128_GCM);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        CleartextKeysetHandle.write(keysetHandle, JsonKeysetWriter.withOutputStream(outputStream));


        String jsonString = new String(outputStream.toByteArray());
        return jsonString;
    }

}
