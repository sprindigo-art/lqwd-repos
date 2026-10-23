package com.lqwd.service;

import com.google.crypto.tink.*;
import com.google.crypto.tink.aead.AeadConfig;
import com.google.crypto.tink.config.TinkConfig;
import com.google.crypto.tink.proto.KeyTemplateOrBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.security.GeneralSecurityException;
import com.google.crypto.tink.integration.awskms.AwsKmsClient;

@Service
public class EncryptService {

    @Value("${app.encrypt_file}")
    private String secretFileName;



    private static final byte[] ASSOCIATED_DATA = "envelope_example".getBytes();

    public byte[] decryptString(byte[] encryptedBytes) throws GeneralSecurityException, IOException {

       // Initialise Tink: register all AEAD key types with the Tink runtime
        AeadConfig.register();
        // Use the primitive to encrypt/decrypt files

        // Read the cleartext keyset
        KeysetHandle handle = null;
        try {
            handle = CleartextKeysetHandle.read(JsonKeysetReader.withFile(new File(secretFileName)));
        } catch (GeneralSecurityException | IOException ex) {
            System.err.println("Error reading key: " + ex);

        }

        // Get the primitive
        Aead aead = null;
        try {
            aead = handle.getPrimitive(Aead.class);
        } catch (GeneralSecurityException ex) {
            System.err.println("Error creating primitive: %s " + ex);

        }


        byte[] decrypted = aead.decrypt(encryptedBytes, ASSOCIATED_DATA);


        return decrypted;
    }
}
