//package lqwd.frontend.httpclient;
//
//import lqwd.frontend.model.ApiKey;
//import lqwd.frontend.model.User;
//import org.json.JSONException;
//import org.json.JSONObject;
//import org.junit.jupiter.api.*;
//import org.slf4j.Logger;
//import org.slf4j.LoggerFactory;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.context.SpringBootTest;
//
//import java.io.IOException;
//import java.util.ArrayList;
//
//import static org.junit.jupiter.api.Assertions.*;
//
//@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
//@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
//public class HttpClientApiKeyTest {
//    private static Logger logger = LoggerFactory.getLogger(HttpClientApiKeyTest.class);
//
//    @Autowired
//    private HttpClientApiKey httpClientApiKey;
//
//    @Autowired
//    private HttpClientToken httpClientToken;
//
//    @Autowired
//    private TokenKey tokenKey;
//
//    private User user;
//
//    private static ApiKey apiKey = new ApiKey();
//
//    @BeforeEach
//    public void init() throws IOException {
//        user = new User("tlnd3@lqwd.money", "tlnd3@lqwd.money");
//        tokenKey = httpClientToken.getToken(user);
//    }
//
//    @Test
//    @Order(1)
//    public void testGenerateApiKey() throws IOException, JSONException {
//
//        String content = httpClientApiKey.generateApiKey(user);
//        JSONObject jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//        assertEquals(jsonObject.getString("class_name"), "Pubkey");
//
//        apiKey = apiKey.mapContent(content);
//
//        assertNotNull(apiKey.getPubkey());
//    }
//
//    @Test
//    @Order(2)
//    public void testGetListOfKeys() throws IOException, JSONException {
//        User user = new User();
//        String content = httpClientApiKey.getListOfKeys(tokenKey.getAccess_token());
//        user = user.mapApiKeyContent(content);
//
//        JSONObject jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//        assertEquals(jsonObject.getString("class_name"), "Pubkey");
//
//        //check that api key generated is in list of received keys
//        for (ApiKey apiKey_tmp: user.getApiKeyList()){
//            if(apiKey_tmp.getPubkey().equals(apiKey.getPubkey())){
//                apiKey = apiKey_tmp;
//            }
//        }
//        //will fail if it never found matchin pubkeys in list
//        assertTrue(user.getApiKeyList().contains(apiKey));
//
//    }
//
//    @Test
//    @Order(3)
//    public void testDeactivateApiKey() throws IOException, JSONException {
//
//        String content = httpClientApiKey.deactivateApiKey(user, apiKey.getPubkey());
//        JSONObject jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//        assertEquals(jsonObject.getString("class_name"), "Pubkey");
//        apiKey = apiKey.mapContent(content);
//        assertEquals(apiKey.getStatus(), "deactivated");
//    }
//
//
//}
