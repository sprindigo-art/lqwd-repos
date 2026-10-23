package com.lqwd.service;

import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.CipherHttpClient;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.response.MainResponse;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.Base64;
import java.util.HashMap;

@RefreshScope
@Service
@RequiredArgsConstructor
public class EncryptService {


    Logger logger = LoggerFactory.getLogger(EncryptService.class);

    private final CipherHttpClient httpClient;

    private final AppProperties appProperties;

    private final HttpClientToken httpClientToken;



    public byte[] decrypt(Long id){
        try {
            String token = getAccessToken();
            if (token == null)
                throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),"An error occurred when connecting to cipher");

            HashMap<String, Object> data = new HashMap<String, Object>();
            data.put("requestType","INTERNAL_FILE_ID");
            data.put("fileId",id);
            logger.info("making cipher request to decrypt");
            String responseData = httpClient.sendRequest("decrypt", data, token);

            JSONObject jsonObject = new JSONObject(responseData);
            return Base64.getDecoder().decode(jsonObject.getString("data"));
        } catch (UnsupportedEncodingException | JSONException e) {
            e.printStackTrace();
            logger.error("Error decrypting: " + e);
            throw new BadRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(),"There was an error decrypting ");
        }
    }

    public byte[] decrypt(String fileName, String nodeName, String passphrase){
        try {
            String token = getAccessToken();

            if (token == null)
                throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),
                        "An error occurred when connecting to cipher");

            HashMap<String, Object> data = new HashMap<>();
            data.put("requestType","INTERNAL_FILE_NAME_AND_NODE");
            data.put("fileName",fileName);
            data.put("nodeName",nodeName);
            if(passphrase != null){
                data.put("password",passphrase);
                logger.info("making cipher request to decrypt" + fileName + ":" + nodeName + ":" + passphrase);
            }
            logger.info("making cipher request to decrypt" + fileName + ":" + nodeName + ": --- " );
            String responseData = httpClient.sendRequest("decrypt", data, token);
            JSONObject jsonObject = new JSONObject(responseData);
            return Base64.getDecoder().decode(jsonObject.getString("data"));
        } catch (UnsupportedEncodingException | JSONException e) {
            logger.info("Error decrypting: {}", e.getMessage());
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),
                    "An error occurred, check your passphrase and try again");
        }
    }

    public String encrypt(byte[] dataToEncrypt, String encryptMethod){
        try {

            String token = getAccessToken();

            if (token == null)
                throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),"An error occurred when connecting to cipher");

            String base64EncodedData = Base64.getEncoder().encodeToString(dataToEncrypt);

            HashMap<String, Object> data = new HashMap<String, Object>();
            data.put("input",base64EncodedData);
            data.put("method",encryptMethod);
            logger.info("making cipher request to encrypt");
            String responseData = httpClient.sendRequest("encrypt", data, token);
            JSONObject jsonObject = new JSONObject(responseData);

            return jsonObject.getString("data");

        } catch (UnsupportedEncodingException | JSONException e) {
            logger.info("Error decrypting: {}", e.getMessage());
            throw new BadRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(),"There was an error decrypting ");
        }
    }



    private  String getAccessToken(){
        try {
            logger.info("making oauth request to get access token");
            MainResponse response = httpClientToken
                    .getTokenClientCredentials(appProperties.getCipher_client_id(),
                            appProperties.getCipher_client_secret());

            if (response.getStatus() != 200){
                return null;
            }
            JSONObject jsonObject = new JSONObject(response.getObject());
            return jsonObject.getString("access_token");

        } catch (IOException | JSONException e) {
            logger.info("An error occurred when get access token for encrypt service: {}",e.getMessage());
        }

        return null;
    }

    public String addCipherFilesForShared(String lndNodeName, String passphrase, String new_passphrase, String email) {
        try {

            String token = getAccessToken();

            if (token == null)
                throw new BadRequestException(HttpStatus.BAD_REQUEST.value(),"An error occurred when connecting to cipher");



            HashMap<String, Object> data = new HashMap<String, Object>();
            data.put("nodeName",lndNodeName);
            data.put("passphrase", passphrase);
            data.put("new_passphrase", new_passphrase);
            data.put("sharedUserName", email);

            logger.info("sending request for shared lnd node to cipher service");
            String responseData = httpClient.sendRequest("shareduser", data, token);
//            JSONObject jsonObject = new JSONObject(responseData);

            return responseData;

        } catch (UnsupportedEncodingException | JSONException e) {
            logger.info("Error decrypting: {}", e.getMessage());
            throw new BadRequestException(HttpStatus.INTERNAL_SERVER_ERROR.value(),"There was an error decrypting ");
        }
    }
}
