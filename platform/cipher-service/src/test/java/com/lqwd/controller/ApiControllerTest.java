package com.lqwd.controller;

import com.google.gson.Gson;
import com.lqwd.DefaultTestConfiguration;
import com.lqwd.cipherengine.AeadCipherEngine;
import com.lqwd.cipherengine.HybridCipherEngine;
import com.lqwd.interfaces.CipherEngine;
import com.lqwd.interfaces.CipherEngineFactory;
import com.lqwd.model.entity.CipherMethod;
import com.lqwd.model.entity.LndFile;
import com.lqwd.model.request.DecryptRequest;
import com.lqwd.model.request.EncryptRequest;
import com.lqwd.model.request.LndFileItem;
import com.lqwd.model.request.SaveLndFileRequest;
import com.lqwd.model.request.SetPasswordRequest;
import com.lqwd.repository.CipherKeyUpdateRepository;
import com.lqwd.repository.CipherMethodRepository;
import com.lqwd.repository.CipherMethodUpdateRepository;
import com.lqwd.repository.LndFileRepository;
import com.lqwd.repository.SecretKeyChangeLogRepository;
import com.lqwd.service.CipherService;
import com.lqwd.service.KubenetesService;
import com.lqwd.service.OauthService;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.core.user.OAuth2UserAuthority;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.security.oauth2.provider.OAuth2Request;
import org.springframework.security.oauth2.provider.token.ResourceServerTokenServices;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit4.SpringJUnit4ClassRunner;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@RunWith(SpringJUnit4ClassRunner.class)
@WebMvcTest(controllers=ApiController.class, properties={
        "app.resource_id=resource-server-rest-api" ,
        "app.cipher_asd=envelope_example",
        "spring.profiles.active=test",
        "app.auth_user_name=aa" ,
        "app.auth_password=aa",
        "app.kubernetes.config.token=aa" ,
        "app.kubernetes.config.cert_data=aa"
})
@TestPropertySource(properties = {"WENV=development"})
@Import(DefaultTestConfiguration.class)
public class ApiControllerTest {


    @Autowired
    MockMvc mvc;

    @Autowired
    CipherService cipherService;

    @MockBean
    CipherMethodRepository cipherMethodRepository;

    @MockBean
    CipherKeyUpdateRepository cipherKeyUpdateRepository;

    @MockBean
    SecretKeyChangeLogRepository secretKeyChangeLogRepository;

    @MockBean
    CipherMethodUpdateRepository cipherMethodUpdateRepository;

    @MockBean
    LndFileRepository lndFileRepository;


    @MockBean
    CipherEngineFactory cipherEngineFactory;

    @MockBean
    OauthService oauthService;

    @MockBean
    KubenetesService kubenetesService;

    @Autowired
    AeadCipherEngine aeadCipherEngine;

    @Autowired
    HybridCipherEngine hybridCipherEngine;



    @MockBean
    public ResourceServerTokenServices resourceServerTokenServices;





    @Before
    public void setupOauth2Authentication() {
        GrantedAuthority auth = new OAuth2UserAuthority("ROLE_ADMIN", Collections.singletonMap("",""));
        OAuth2Request req = new OAuth2Request(Collections.emptyMap(), "", Collections.unmodifiableCollection(Arrays.asList(auth)), true , null, Collections.singleton("resource-server-rest-api"), null, null,null);
        final OAuth2Authentication authentication = new OAuth2Authentication(req, null);
        when(resourceServerTokenServices.loadAuthentication(anyString())).thenReturn(authentication);
    }


    @Test
    public void testSaveFileWhenDomainNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                        .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("domain is required")));
    }

    @Test
    public void testSaveFileWhenKeyNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("lqwd.lnd")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("key is required")));


    }

    @Test
    public void testSaveFileWhenNetworkNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("lqwd.lnd")
                .key("1")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("network is required")));

    }

    @Test
    public void testSaveFileWhenNodeNameNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("nodename is required")));

    }

    @Test
    public void testSaveFileWhenPubkeyNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("pubkey is required")));

    }

    @Test
    public void testSaveFileWhenRpchostNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("rpchost is required")));

    }

    @Test
    public void testSaveFileWhenStatusNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("status is required")));

    }

    @Test
    public void testSaveFileWhenRpcuserNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .status("status")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("rpcuser is required")));

    }

    @Test
    public void testSaveFileWhenRpcpassNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .status("status")
                .rpcuser("rpcuser")
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("rpcpass is required")));

    }

    @Test
    public void testSaveFileWhenFilesNotProvided() throws Exception {
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .status("status")
                .rpcuser("rpcuser")
                .rpcpass("rpcpass")
                .build();

        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("please provide at least one file")));

    }

    @Test
    public void testSaveFileWhenFileTypeInFilesNotProvided() throws Exception {

        List<LndFileItem> items = new ArrayList<LndFileItem>();
        items.add(LndFileItem.builder().build());
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .status("status")
                .rpcuser("rpcuser")
                .rpcpass("rpcpass")
                .files(items)
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("file type is required")));

    }


    @Test
    public void testSaveFileWhenDataInFilesNotProvided() throws Exception {

        List<LndFileItem> items = new ArrayList<LndFileItem>();
        items.add(LndFileItem.builder()
                .fileType("filetype")
                .build());
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .status("status")
                .rpcuser("rpcuser")
                .rpcpass("rpcpass")
                .files(items)
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("Data is required")));

    }

    @Test
    public void testSaveFileWhenDataInFilesNotBase64() throws Exception {

        List<LndFileItem> items = new ArrayList<LndFileItem>();
        items.add(LndFileItem.builder()
                .fileType("filetype")
                .data("data&*")
                .build());
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .status("status")
                .rpcuser("rpcuser")
                .rpcpass("rpcpass")
                .files(items)
                .build();
        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value(containsString("Invalid data. Base64 encoded  is required")));
    }


    @Test
    public void testSaveFile() throws Exception {

        List<LndFileItem> items = new ArrayList<LndFileItem>();
        items.add(LndFileItem.builder()
                .fileType("filetype")
                .data(Base64.getEncoder().encodeToString("data".getBytes()))
                .build());
        SaveLndFileRequest fileRequest = SaveLndFileRequest.builder()
                .domain("domain")
                .key("key")
                .network("network")
                .nodeName("node")
                .pubkey("pubkey")
                .rpchost("rpchost")
                .status("status")
                .rpcuser("rpcuser")
                .rpcpass("rpcpass")
                .files(items)
                .build();

        String methodName = "AEAD";
        CipherMethod method = getCipherMethod(methodName);
        when(cipherMethodRepository.findDefault()).thenReturn(Optional.of(method));
        when(cipherMethodRepository.findByName(methodName)).thenReturn(Optional.of(method));
        when(cipherEngineFactory.getCipherEngine(methodName)).thenReturn(aeadCipherEngine);

        String jsonRequest = (new Gson()).toJson(fileRequest);
        mvc.perform(post("/api/v1/savefile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().string("OK"));
    }


    @Test
    public void testAEADEncrypt() throws Exception {
        String methodName = "AEAD";
        CipherMethod method = getCipherMethod(methodName);
        when(cipherMethodRepository.findByName(methodName)).thenReturn(Optional.of(method));
        when(cipherEngineFactory.getCipherEngine(methodName)).thenReturn(aeadCipherEngine);

        String data = Base64.getEncoder().encodeToString("input_data".getBytes());

        EncryptRequest  encryptRequest = EncryptRequest.builder()
                .input(data)
                .method(methodName)
                .build();

        String jsonRequest = (new Gson()).toJson(encryptRequest);
        mvc.perform(post("/api/v1/encrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").exists());
    }


    @Test
    public void testSetPassword() throws Exception {
        String oldPassword = "abc";
        String newPassword = "123";
        String data = Base64.getEncoder().encodeToString("input_data".getBytes());


        String nodeName="slnd-12345";
        String methodName = "AEAD";
        String password = "mypasssword";

        CipherMethod method = getCipherMethod(methodName);
        when(cipherMethodRepository.findById(1L)).thenReturn(Optional.of(method));
        when(cipherMethodRepository.findByName(methodName)).thenReturn(Optional.of(method));
        when(cipherEngineFactory.getCipherEngine(methodName)).thenReturn(aeadCipherEngine);


        //mock files use files in db that have been encrypted with
        List<LndFile> lndFiles = new ArrayList<LndFile>();
        LndFile file = new LndFile();
        file.setNodeName(nodeName);
        file.setId(1L);
        file.setCipherMethod(method.getId());
        String encrypted = aeadCipherEngine.encrypt(data, new String(Base64.getDecoder().decode(method.getSecretKey().getBytes())),oldPassword);
        file.setSfile(Base64.getDecoder().decode(encrypted));
        file.setUserFile(true);
        lndFiles.add(file);

        String decrypted = aeadCipherEngine.decrypt(encrypted, new String(Base64.getDecoder().decode(method.getSecretKey().getBytes())),oldPassword);

        when(lndFileRepository.getAllUserFilesByNode(nodeName)).thenReturn(lndFiles);



        //call set password request
        SetPasswordRequest encryptRequest = SetPasswordRequest.builder()
                .newPassword(newPassword)
                .oldPassword(oldPassword)
                .nodeName(nodeName)
                .build();

        String jsonRequest = (new Gson()).toJson(encryptRequest);
        ResultActions actions = mvc.perform(post("/api/v1/setpassword")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().string("OK"));


        encrypted = Base64.getEncoder().encodeToString(lndFiles.get(0).getSfile());
        //run decrypt request for that file with the new password
        DecryptRequest  decryptRequest = DecryptRequest.builder()
                .input(encrypted)
                .method(methodName)
                .password(newPassword)
                .requestType("EXTERNAL")
                .build();

        jsonRequest = (new Gson()).toJson(decryptRequest);
        ResultActions res = mvc.perform(post("/api/v1/decrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").exists())
                .andExpect(jsonPath("$.data").value(data));

    }

    @Test
    public void testEncryptDecryptWithPassword() throws Exception {
        String methodName = "AEAD";
        String password = "mypasssword";

        CipherMethod method = getCipherMethod(methodName);
        when(cipherMethodRepository.findByName(methodName)).thenReturn(Optional.of(method));
        when(cipherEngineFactory.getCipherEngine(methodName)).thenReturn(aeadCipherEngine);

        String data = Base64.getEncoder().encodeToString("input_data".getBytes());

        EncryptRequest  encryptRequest = EncryptRequest.builder()
                .input(data)
                .password(password)
                .method(methodName)
                .build();

        String jsonRequest = (new Gson()).toJson(encryptRequest);
        ResultActions actions = mvc.perform(post("/api/v1/encrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").exists());

        JSONObject jsonObject = new JSONObject(actions.andReturn().getResponse().getContentAsString());
        String encryptedData = jsonObject.get("data").toString();


        //when password is not provided test that it will fail because original contented was encrypted with password

        DecryptRequest  decryptRequest = DecryptRequest.builder()
                .input(encryptedData)
                .method(methodName)
                .requestType("EXTERNAL")
                .build();

        jsonRequest = (new Gson()).toJson(decryptRequest);
        mvc.perform(post("/api/v1/decrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.message").value("Cannot decrypt. Server errornull:null:null"));



        //decrypt should pass now as password is provided
        decryptRequest = DecryptRequest.builder()
                .input(encryptedData)
                .method(methodName)
                .password(password)
                .requestType("EXTERNAL")
                .build();

        jsonRequest = (new Gson()).toJson(decryptRequest);
        mvc.perform(post("/api/v1/decrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").exists());


    }

    @Test
    public void testHYBRIDEncrypt() throws Exception {
        String methodName = "HYBRID";

        CipherMethod method = getCipherMethod(methodName);

        when(cipherMethodRepository.findByName(methodName)).thenReturn(Optional.of(method));
        when(cipherEngineFactory.getCipherEngine(methodName)).thenReturn(hybridCipherEngine);

        String data = Base64.getEncoder().encodeToString("input_data".getBytes());
        EncryptRequest  encryptRequest = EncryptRequest.builder()
                .input(data)
                .method(methodName)
                .build();

        String jsonRequest = (new Gson()).toJson(encryptRequest);
        ResultActions res = mvc.perform(post("/api/v1/encrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").exists());
    }


    @Test
    public void testHYBRIDDecrypt() throws Exception {
        String methodName = "HYBRID";

        CipherMethod method = getCipherMethod(methodName);

        when(cipherMethodRepository.findByName(methodName)).thenReturn(Optional.of(method));
        when(cipherEngineFactory.getCipherEngine(methodName)).thenReturn(hybridCipherEngine);
        String encrypted = "AVZyttYDccEzkJ+ZrajIsmOsoWXgxujHz3ogx5UK/GLD9xE/a8S1TTSzCzw4lMokb78L1pRNARCTyH6WMQWbOI1gCb0klo88pqgDWg==";
        String data = Base64.getEncoder().encodeToString("input_data".getBytes());
        DecryptRequest  encryptRequest = DecryptRequest.builder()
                .input(encrypted)
                .method(methodName)
                .requestType("EXTERNAL")
                .build();

        String jsonRequest = (new Gson()).toJson(encryptRequest);
        ResultActions res = mvc.perform(post("/api/v1/decrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").exists())
                .andExpect(jsonPath("$.data").value(data));
    }




    @Test
    public void testAEADDecrypt() throws Exception {
        String methodName = "AEAD";

        CipherMethod method = getCipherMethod(methodName);
        String encrypted = "ASDIwW4HOTEPTe0xNZ8xUIuMKOkRV2elYeZn5B3Cub2GO40n4E7PYqC1OA==";
        when(cipherMethodRepository.findByName(methodName)).thenReturn(Optional.of(method));
        when(cipherEngineFactory.getCipherEngine(methodName)).thenReturn(aeadCipherEngine);


        String data = Base64.getEncoder().encodeToString("input_data".getBytes());
        DecryptRequest  encryptRequest = DecryptRequest.builder()
                .input(encrypted)
                .method(methodName)
                .requestType("EXTERNAL")
                .build();

        String jsonRequest = (new Gson()).toJson(encryptRequest);
        ResultActions res = mvc.perform(post("/api/v1/decrypt")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .content(jsonRequest)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").exists())
                .andExpect(jsonPath("$.data").value(data));
    }


    @Test
    public void testloadAEADMethod() throws Exception {
        String methodName = "AEAD";

        CipherMethod method = getCipherMethod(methodName);
        Optional<CipherMethod> methodOption = Optional.of(method);
        when(cipherMethodRepository.findByName(methodName)).thenReturn(methodOption);
        when(cipherMethodRepository.loadDefaultMethodName()).thenReturn(methodName);

        ResultActions res = mvc.perform(get("/api/v1/admin/get/"+methodName)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization","Bearer test_token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.methodName").exists())
                .andExpect(jsonPath("$.secretKey").exists())
                .andExpect(jsonPath("$.methodName").value(containsString("AEAD")));
    }

    private CipherMethod getCipherMethod(String methodName){
        String aeadEncodedSecretKey = "eyJwcmltYXJ5S2V5SWQiOjU1MDAyNzYzMCwia2V5IjpbeyJrZXlEYXRhIjp7InR5cGVVcmwiOiJ0eXBlLmdvb2dsZWFwaXMuY29tL2dvb2dsZS5jcnlwdG8udGluay5BZXNHY21LZXkiLCJ2YWx1ZSI6IkdoQ2x2dFVoQ2FhREhxa3ZmYmlncW9LSSIsImtleU1hdGVyaWFsVHlwZSI6IlNZTU1FVFJJQyJ9LCJzdGF0dXMiOiJFTkFCTEVEIiwia2V5SWQiOjU1MDAyNzYzMCwib3V0cHV0UHJlZml4VHlwZSI6IlRJTksifV19";
        String hybridEncodedSecretkey = "ewogICJwcmltYXJ5S2V5SWQiOiAxNDUwMzU4NDg2LAogICJrZXkiOiBbCiAgICB7CiAgICAgICJrZXlEYXRhIjogewogICAgICAgICJ0eXBlVXJsIjogInR5cGUuZ29vZ2xlYXBpcy5jb20vZ29vZ2xlLmNyeXB0by50aW5rLkVjaWVzQWVhZEhrZGZQcml2YXRlS2V5IiwKICAgICAgICAidmFsdWUiOiAiRW9zQkVrUUtCQWdDRUFNU09oSTRDakIwZVhCbExtZHZiMmRzWldGd2FYTXVZMjl0TDJkdmIyZHNaUzVqY25sd2RHOHVkR2x1YXk1QlpYTkhZMjFMWlhrU0FoQVFHQUVZQWhvZ1BQdE1qZWhsa0pPem5CcEJON2h2MGpqRHFIOWFKVDFQd1RUZmFFc2MzdkVpSVFER0VubDhsN3llWjlMN0FxWFNqZ0cwN3lWYWdRdzZLK3RTbTA0SGtzOGxMaG9nSjNuM0VDOHkrNC92VHFsUkJUZzMza1BQMXVKWXNhLytKdSt2Ly9UWnhXUT0iLAogICAgICAgICJrZXlNYXRlcmlhbFR5cGUiOiAiQVNZTU1FVFJJQ19QUklWQVRFIgogICAgICB9LAogICAgICAic3RhdHVzIjogIkVOQUJMRUQiLAogICAgICAia2V5SWQiOiAxNDUwMzU4NDg2LAogICAgICAib3V0cHV0UHJlZml4VHlwZSI6ICJUSU5LIgogICAgfQogIF0KfQ==";

        CipherMethod method = new CipherMethod();
        method.setId(1L);
        method.setActive(true);
        method.setName(methodName);
        if(methodName.equals("AEAD")){
            method.setSecretKey(aeadEncodedSecretKey);
        }
        if(methodName.equals("HYBRID")){
            method.setSecretKey(hybridEncodedSecretkey);
        }
        return method;
    }


    private CipherEngine getCipherEngine(String methodName){
        CipherEngine cipherEngine  = null;

        if(methodName.equals("AEAD")){
            cipherEngine = new AeadCipherEngine();
        }else if(methodName.equals("HYBRID")){
            cipherEngine  =  new HybridCipherEngine();
        }
        return cipherEngine;
    }
}
