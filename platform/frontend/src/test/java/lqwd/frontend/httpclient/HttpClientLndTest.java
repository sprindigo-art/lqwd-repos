//package lqwd.frontend.httpclient;
//
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
//import static org.junit.jupiter.api.Assertions.*;
//
//@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
//@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
//public class HttpClientLndTest {
//
//    private static Logger logger = LoggerFactory.getLogger(HttpClientLndTest.class);
//
//    @Autowired
//    private HttpClientToken httpClientToken;
//
//    @Autowired
//    private  HttpClientLnd httpClientLnd;
//
//    @Autowired
//    private TokenKey tokenKey;
//
//    @BeforeEach
//    public void init() throws IOException {
//        User user = new User("tlnd3@lqwd.money", "tlnd3@lqwd.money");
//        tokenKey = httpClientToken.getToken(user);
//    }
//
//    @Test
//    @Order(1)
//    public void TestGetChannels() throws IOException {
//        String content = httpClientLnd.getChannels(tokenKey.getAccess_token());
//        assertEquals(content, "Channels request successfully sent to Kafka");
//
//    }
//
//    @Test
//    @Order(2)
//    public void TestGetInfo() throws IOException {
//        String content = httpClientLnd.getInfo(tokenKey.getAccess_token());
//        assertEquals(content, "Getinfo request successfully sent to Kafka");
//
//    }
//
//    @Test
//    @Order(3)
//    public void TestGetPeers() throws IOException {
//        String content = httpClientLnd.getPeers(tokenKey.getAccess_token());
//        assertEquals(content, "Peers request successfully sent to Kafka");
//
//    }
//
//    @Test
//    @Order(4)
//    public void TestGetFees() throws IOException {
//        String content = httpClientLnd.getFees(tokenKey.getAccess_token());
//        assertEquals(content, "Fees request successfully sent to Kafka");
//
//    }
//
//    @Test
//    @Order(5)
//    public void TestGetRecoveryinfo() throws IOException {
//        String content = httpClientLnd.getRecoveryinfo(tokenKey.getAccess_token());
//        assertEquals(content, "getrecoveryinfo request successfully sent to Kafka");
//
//    }
//
//    @Test
//    @Order(6)
//    public void TestGetChannelBalance() throws IOException {
//        String content = httpClientLnd.getChannelbalance(tokenKey.getAccess_token());
//        assertEquals(content, "channelbalance request successfully sent to Kafka");
//
//    }
//
//    @AfterEach
//    public void TestConsumerInfo() throws IOException, JSONException {
//        String content = httpClientLnd.consumerInfo(tokenKey.getAccess_token());
//        JSONObject jsonObject = new JSONObject(content);
//
//        while(!jsonObject.has("tmessageKey")){
//            assertEquals(jsonObject.getString("status"), "204");
//        }
//        assertTrue(jsonObject.has("tmessageKey"));
//
//    }
//
//
//}
