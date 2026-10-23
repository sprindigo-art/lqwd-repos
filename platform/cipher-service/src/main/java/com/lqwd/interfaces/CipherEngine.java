package com.lqwd.interfaces;


import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 *@author Olufemi Thompson
 *
 * Base Encryption/Decryption Interface
 * Every new Encryption/Decryption Implementation should implement this interface
 */
public interface CipherEngine {

    String encrypt(String input, String secretKey, String password) throws GeneralSecurityException, IOException;

    String decrypt(String input, String secretKey, String password) throws GeneralSecurityException, IOException;

    String generateKey() throws GeneralSecurityException, IOException;


}
