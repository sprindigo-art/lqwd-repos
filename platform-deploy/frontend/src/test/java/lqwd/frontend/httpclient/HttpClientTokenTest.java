//package lqwd.frontend.httpclient;
//
//import lqwd.frontend.model.AccountInfo;
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
//public class HttpClientTokenTest {
//
//    static Logger logger = LoggerFactory.getLogger(HttpClientTokenTest.class);
//
//    @Autowired
//    private HttpClientToken httpClientToken;
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
//    public void testGetTokenUsername() throws IOException {
//        User user = new User("tlnd3@lqwd.money", null, "tlnd3@lqwd.money");
//        TokenKey tokenKey = httpClientToken.getToken(user);
//        assertNotNull(tokenKey);
//        assertNotNull(tokenKey.getAccess_token());
//    }
//
//    @Test
//    @Order(2)
//    public void testGetTokenEmail() throws IOException {
//        User user = new User("tlnd3@lqwd.money", "tlnd3@lqwd.money");
//        TokenKey tokenKey = httpClientToken.getToken(user);
//        assertNotNull(tokenKey);
//        assertNotNull(tokenKey.getAccess_token());
//    }
//
//
//    @Test
//    @Order(3)
//    public void testUpdateUser() throws IOException {
//
//        User user = new User();
//        user.setUsername("tlnd3@lqwd.money");
//        user.setEmail("tlnd3@lqwd.money");
//        user.setFirstName("Test");
//        user.setLastName("User");
//        user.setPhone("1234567890");
//        user.setReceiveNews(true);
//        user.setFa2(true);
//        user = httpClientToken.updateAccount(user, tokenKey.getAccess_token());
//
//    }
//
//    @Test
//    @Order(4)
//    public void testGetUser() throws IOException {
//
//        User user = httpClientToken.getUser(tokenKey.getAccess_token());
//        assertNotNull(user);
//        assertEquals(user.getEmail(), "tlnd3@lqwd.money");
//        assertEquals(user.getUsername(), "tlnd3@lqwd.money");
//        assertEquals(user.getFirstName(), "Test");
//        assertEquals(user.getLastName(), "User");
//        assertEquals(user.getPhone(), "1234567890");
//        assertTrue(user.isReceiveNews());
//        assertTrue(user.isFa2());
//
//    }
//
//    @Test
//    @Order(5)
//    public void testPasswordRecovery() throws IOException {
//        String content = httpClientToken.passwordRecovery("tlnd3@lqwd.money");
//        assertEquals(content, "200");
//    }
//
//    @Test
//    @Order(6)
//    public void testChangePassword() throws IOException {
//
//        //cant check without token from email (instead will just check path returns 200 and exists)
//        String content = httpClientToken.changePassword(tokenKey.getAccess_token(), "tlnd3@lqwd.money", "tlnd3@lqwd.money");
//        assertEquals(content, "200");
//    }
//
////    @Test
////    @Order(7)
////    public void testResetPassword() throws IOException, JSONException {
////
////        String content = httpClientToken.resetPassword(tokenKey.getAccess_token(), "tlnd3@lqwd.money", "tlnd3@lqwd.money");
////        logger.info(content);
////        JSONObject jsonObject = new JSONObject(content);
////        assertEquals(jsonObject.getString("status"), "200");
////
////        //change to new password to test
////        tokenKey = httpClientToken.getToken(new User("tlnd3@lqwd.money", "tlnd3@lqwd.money"));
////        assertNotNull(tokenKey);
////        assertNotNull(tokenKey.getAccess_token());
////
////        //change it back to original password
////        content = httpClientToken.resetPassword(tokenKey.getAccess_token(), "tlnd3@lqwd.money", "tlnd3@lqwd.money");
////        jsonObject = new JSONObject(content);
////        assertEquals(jsonObject.getString("status"), "200");
////        tokenKey = httpClientToken.getToken(new User("tlnd3@lqwd.money", "tlnd3@lqwd.money"));
////        assertNotNull(tokenKey);
////        assertNotNull(tokenKey.getAccess_token());
////    }
//
////    @Test
////    @Order(8)
////    public void testSetF2ASecret() throws IOException, JSONException {
////
////        User user = httpClientToken.getUser(tokenKey.getAccess_token());
////        user.setFa2secret("BYIZRCMLOITPLZWA");
////
////        String content = httpClientToken.setF2aSecret(user, tokenKey.getAccess_token());
////        JSONObject jsonObject = new JSONObject(content);
////        assertEquals(jsonObject.getString("status"), "200");
////        assertEquals(jsonObject.getString("error"), "null");
////
////        JSONObject jsonObject1 = new JSONObject(jsonObject.getString("object"));
////
////        assertEquals(jsonObject1.getString("secret"), "BYIZRCMLOITPLZWA");
////        assertEquals(jsonObject1.getString("email"), user.getEmail());
////
////    }
////
////    @Test
////    @Order(9)
////    public void testGetF2ASecret() throws IOException, JSONException {
////
////        User user = httpClientToken.getUser(tokenKey.getAccess_token());
////        String content = httpClientToken.getF2aSecret(user.getEmail(), tokenKey.getAccess_token());
////        logger.info(content);
////        assertEquals(content, "BYIZRCMLOITPLZWA");
////
////    }
//
//    @Test
//    @Order(10)
//    public void testSendVerificationEmail() throws IOException, JSONException {
//        User user = httpClientToken.getUser(tokenKey.getAccess_token());
//        String content = httpClientToken.sendVerificationEmail(user.getEmail());
//        JSONObject jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//    }
//
//    @Test
//    @Order(11)
//    public void testCheckUsername() throws IOException, JSONException {
//        User user = httpClientToken.getUser(tokenKey.getAccess_token());
//        String content = httpClientToken.checkUsername(user.getUsername());
//        JSONObject jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//        assertEquals(jsonObject.getString("object"), "Username already exist");
//
//        content = httpClientToken.checkUsername("FakeUserEmail");
//        jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//        assertEquals(jsonObject.getString("object"), "ok");
//    }
//
//    @Test
//    @Order(12)
//    public void testCheckEmail() throws IOException, JSONException {
//        User user = httpClientToken.getUser(tokenKey.getAccess_token());
//        String content = httpClientToken.checkEmail(user.getEmail());
//        JSONObject jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//        assertEquals(jsonObject.getString("object"), "Email already exist");
//
//        content = httpClientToken.checkEmail("FakeUserEmail@fake.com");
//        jsonObject = new JSONObject(content);
//        assertEquals(jsonObject.getString("status"), "200");
//        assertEquals(jsonObject.getString("object"), "ok");
//    }
//
//    @Test
//    @Order(13)
//    public void testGetAccountInfo() throws IOException, JSONException {
//        AccountInfo accountInfo = httpClientToken.getUserAccountInfo(tokenKey.getAccess_token());
//        assertEquals(accountInfo.getStatus(), "active");
//        assertEquals(accountInfo.getPlan(), "free");
//
//    }
//}
