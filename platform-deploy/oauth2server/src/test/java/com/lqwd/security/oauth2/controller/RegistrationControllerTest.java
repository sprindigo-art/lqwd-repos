//package com.lqwd.security.oauth2.controller;
//
//import com.google.gson.Gson;
//import com.lqwd.security.oauth2.controller.admin.UserController;
//import com.lqwd.security.oauth2.model.request.RegistrationRequest;
//import com.lqwd.security.oauth2.model.request.UserRequest;
//import com.lqwd.security.oauth2.model.security.ConfirmationToken;
//import com.lqwd.security.oauth2.model.security.User_;
//import com.lqwd.security.oauth2.repository.UserRepository;
//import com.lqwd.security.oauth2.service.ConfirmationTokenService;
//import com.lqwd.security.oauth2.service.UserService;
//import org.apache.http.HttpHeaders;
//import org.json.JSONObject;
//import org.junit.Before;
//import org.junit.Test;
//import org.junit.runner.RunWith;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.beans.factory.annotation.Value;
//import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
//import org.springframework.boot.test.context.SpringBootTest;
//import org.springframework.boot.test.mock.mockito.SpyBean;
//import org.springframework.http.MediaType;
//import org.springframework.mail.javamail.JavaMailSender;
//import org.springframework.test.context.TestExecutionListeners;
//import org.springframework.test.context.junit4.SpringJUnit4ClassRunner;
//import org.springframework.test.web.servlet.MockMvc;
//
//import static org.hamcrest.Matchers.containsString;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
//import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
//@SpringBootTest(webEnvironment= SpringBootTest.WebEnvironment.RANDOM_PORT)
//@AutoConfigureMockMvc
//@RunWith(SpringJUnit4ClassRunner.class)
//@TestExecutionListeners(listeners = {TestExecutionListener.class},
//        mergeMode = TestExecutionListeners.MergeMode.MERGE_WITH_DEFAULTS)
//public class RegistrationControllerTest {
//    @Autowired
//    private RegistrationController registrationController;
//
//    @Autowired
//    private MockMvc mvc;
//    @Autowired
//    UserService userService;
//    @Autowired
//    ConfirmationTokenService confirmationTokenService;
//    @Autowired
//    UserController userController;
//    @Autowired
//    UserRepository userRepository;
//    @Autowired
//    AuthorizedController authorizedController;
//
//    @SpyBean
//    JavaMailSender javaMailSender;
//
//    @Value("${app.appusername}")
//    private String appusername ;
//   @Value("${app.apppassword}")
//    private String apppassword ;
//
//    private String username = "tlnd6@lqwd.money";
//    private String password = "tlnd6@lqwd.money";
//    private String email = "tlnd6@lqwd.money";
//    String token = "";
//    String encoding = java.util.Base64.getEncoder().encodeToString((appusername+":"+apppassword).getBytes());
//    @Before
//    public void setup() throws Exception {
//      User_ user_ = userService.findByUsername(username);
//      if(user_==null){
//          RegistrationRequest registrationRequest = RegistrationRequest.builder()
//                  .username(username)
//                  .email(username)
//                  .password(username)
//                  .firstname("firstname")
//                  .lastname("lastname")
//                  .companyName("companyName")
//                  .serviceName("lnd-advanced-processing-send-message")
//                  .f2a(true)
//                  .build();
//          registrationController.registrationV2(registrationRequest);
//      }
//        token = getAccessTokenTest();
//    }
//    public String getAccessTokenTest() throws Exception {
//        String response  = mvc.perform(post("/oauth/token")
//                        .header(HttpHeaders.AUTHORIZATION,"Basic "+encoding)
//                        .header(HttpHeaders.ACCEPT, "*/*")
//                        .accept("application/json")
//                        .contentType(MediaType.MULTIPART_FORM_DATA)
//                        .param("username",username)
//                        .param("password",password)
//                        .param("grant_type","password")
//                        .param("client_id","lnd-advanced-processing-send-message"))
//                .andDo(print())
//                .andExpect(status().isOk())
//                .andReturn().getResponse().getContentAsString();
//            JSONObject jsonObject = new JSONObject(response);
//            if(!jsonObject.getString("access_token").isEmpty()){
//                token = jsonObject.getString("access_token");
//            }
//        return token;
//    }
////    @Test
////    public void registrationV2Test() throws Exception  {
////        RegistrationRequest registrationRequest = RegistrationRequest.builder()
////                .username("tlnd6username")
////                .email("tlnd6username@email.com")
////                .password("password")
////                .firstname("firstname")
////                .lastname("lastname")
////                .companyName("companyName")
////                .serviceName("lnd-advanced-processing-send-message")
////                .f2a(true)
////                .build();
////        String jsonString  = new Gson().toJson(registrationRequest);
////        mvc.perform(post("/registration/v2")
////                        .header(HttpHeaders.AUTHORIZATION,"Basic "+encoding)
////                        .header("Content-Type","application/json")
////                        .param("grand_type","password")
////                        .param("client_id","lnd-advanced-processing-send-message")
////                        .content(jsonString))
////                .andDo(print())
////                .andExpect(status().isOk());
////    }
//    @Test
//    public void registrationV2TestUsernameNotProvided() throws Exception  {
//        RegistrationRequest registrationRequest = RegistrationRequest.builder()
//                .email(username)
//                .password(password)
//                .firstname("firstname")
//                .lastname("lastname")
//                .companyName("companyName")
//                .serviceName("serviceName")
//                .f2a(true)
//                .build();
//        String jsonString  = new Gson().toJson(registrationRequest);
//        mvc.perform(post("/registration/v2")
//                        .accept("application/json")
//                        .contentType(MediaType.APPLICATION_JSON)
//                        .content(jsonString))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(content().string("{\"error\":true,\"message\":\"User name is null\"}"));
//    }
//    @Test
//    public void registrationV2TestEmailNotProvided() throws Exception  {
//        RegistrationRequest registrationRequest = RegistrationRequest.builder()
//                .username(username)
//                .password(password)
//                .firstname("firstname")
//                .lastname("lastname")
//                .companyName("companyName")
//                .serviceName("serviceName")
//                .f2a(true)
//                .build();
//        String jsonString  = new Gson().toJson(registrationRequest);
//        mvc.perform(post("/registration/v2")
//                        .accept("application/json")
//                        .contentType(MediaType.APPLICATION_JSON)
//                        .content(jsonString))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(content().string("{\"error\":true,\"message\":\"Email is null\"}"));
//    }
//    @Test
//    public void registrationV2TestPasswordNotProvided() throws Exception  {
//        RegistrationRequest registrationRequest = RegistrationRequest.builder()
//                .username(username)
//                .email(email)
//                .firstname("firstname")
//                .lastname("lastname")
//                .companyName("companyName")
//                .serviceName("serviceName")
//                .f2a(true)
//                .build();
//        String jsonString  = new Gson().toJson(registrationRequest);
//        mvc.perform(post("/registration/v2")
//                        .accept("application/json")
//                        .contentType(MediaType.APPLICATION_JSON)
//                        .content(jsonString))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(content().string("{\"error\":true,\"message\":\"User password is null\"}"));
//    }
//    @Test
//    public void registrationV2TestUsernameExist() throws Exception  {
//        RegistrationRequest registrationRequest = RegistrationRequest.builder()
//                .username(username)
//                .email(email)
//                .password(password)
//                .lastname("lastname")
//                .companyName("companyName")
//                .serviceName("serviceName")
//                .f2a(true)
//                .build();
//        String jsonString  = new Gson().toJson(registrationRequest);
//        mvc.perform(post("/registration/v2")
//                        .accept("application/json")
//                        .contentType(MediaType.APPLICATION_JSON)
//                        .content(jsonString))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(content().string("{\"error\":true,\"message\":\"Looks like a user already exist with the email or username provided\"}"));
//    }
//    @Test
//    public void registrationV2TestEmailExist() throws Exception  {
//        RegistrationRequest registrationRequest = RegistrationRequest.builder()
//                .username(username)
//                .email(email)
//                .password(password)
//                .lastname("lastname")
//                .companyName("companyName")
//                .serviceName("serviceName")
//                .f2a(true)
//                .build();
//        String jsonString  = new Gson().toJson(registrationRequest);
//        mvc.perform(post("/registration/v2")
//                        .accept("application/json")
//                        .contentType(MediaType.APPLICATION_JSON)
//                        .content(jsonString))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(content().string("{\"error\":true,\"message\":\"Looks like a user already exist with the email or username provided\"}"));
//    }
//    @Test
//    public void sendVerificationTest() throws Exception  {
//        UserRequest userRequest = new UserRequest();
//        userRequest.setEmail(email);
//        userRequest.setUsername(username);
//        userRequest.setFirstName("firstname");
//        userRequest.setLastName("lastname");
//        userRequest.setPhone("");
//        userRequest.setFa2(true);
//        userRequest.setReceiveNews(false);
//        String jsonString  = new Gson().toJson(userRequest);
//        this.mvc.perform(post("/registration/verification/send")
//                        .contentType(MediaType.APPLICATION_JSON)
//                        .content(jsonString))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void sendVerificationTestUserNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/verification/send")
//                        .contentType(MediaType.APPLICATION_JSON))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void f2aSaveTest() throws Exception  {
//        User_ user  = userService.findByUsername(username);
//        String f2asecret = "f2asecret";
//        this.mvc.perform(post("/registration/f2a/save")
//                        .param("username",username)
//                        .param("f2asecret",f2asecret))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void f2aSaveTestUsernameNotProvided() throws Exception  {
//        User_ user = user = userService.findByUsername(username);
//        String f2asecret = "f2asecret";
//        this.mvc.perform(post("/registration/f2a/save")
//                        .param("f2asecret",f2asecret))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void f2aSaveTestF2asecretNotProvided() throws Exception  {
//        User_ user = user = userService.findByUsername(username);
//        String f2asecret = user.getF2asecret();
//        this.mvc.perform(post("/registration/f2a/save")
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void f2aGetTest() throws Exception  {
//        this.mvc.perform(post("/registration/f2a/get")
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void f2aGetTestUsernameNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/f2a/get"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public  void checkUsernameTest() throws Exception  {
//        this.mvc.perform(post("/registration/checkusername")
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isOk())
//                .andExpect(content().string("Username already exist"));
//    }
//    @Test
//    public  void checkUsernameTestUsernameNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/checkusername"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void checkEmailTest() throws Exception  {
//        this.mvc.perform(post("/registration/checkemail")
//                        .param("email",email))
//                .andDo(print())
//                .andExpect(status().isOk())
//                .andExpect(content().string("Email already exist"));
//    }
//    @Test
//    public void checkEmailTestEmailNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/checkemail"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void confirmationEmailTestTokenNotProvided() throws Exception  {
//        this.mvc.perform(get("/registration/confirm-account"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//
//    @Test
//    public  void passwordRecoveryEmailTestEmailNotProvided() throws Exception  {
//        this.mvc.perform(get("/registration/password-recovery"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public  void passwordRecoveryEmailTest() throws Exception  {
//        this.mvc.perform(get("/registration/password-recovery")
//                        .param("email",email))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void confirmationEmailTest() throws Exception  {
//        registrationController.passwordRecoveryEmail(email);
//        User_ user_ = userService.findByUsername(username);
//        ConfirmationToken token1 = confirmationTokenService.findByUserId(user_.getId());
//        this.mvc.perform(get("/registration/confirm-account")
//                        .param("token",token1.getConfirmationToken()))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void updatePasswordTokenTest() throws Exception  {
//        registrationController.passwordRecoveryEmail(email);
//        User_ user_ = userService.findByUsername(username);
//        ConfirmationToken token1 = confirmationTokenService.findByUserId(user_.getId());
//        this.mvc.perform(post("/registration/update-password")
//                        .param("token1",token1.getConfirmationToken())
//                        .param("passwordn",password)
//                        .accept("application/json")
//                        .contentType(MediaType.MULTIPART_FORM_DATA))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void updatePasswordTokenTestTokenNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/update-password")
//                        .param("passwordn",password))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(status().reason(containsString("Required String parameter 'token1' is not present")));
//    }
//    @Test
//    public void updatePasswordTokenTestPasswordIsNull() throws Exception  {
//        this.mvc.perform(post("/registration/update-password")
//                        .param("token1",token))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(status().reason(containsString("Required String parameter 'passwordn' is not present")));
//    }
//
//    @Test
//    public void updatePasswordTest() throws Exception  {
//        this.mvc.perform(post("/registration/update/password")
//                        .param("username",username)
//                        .param("old_password",password)
//                        .param("password",password)
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void updatePasswordTestUsernameNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/update/password")
//                        .param("old_password",password)
//                        .param("password",password)
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void updatePasswordTestoldPasswordNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/update/password")
//                        .param("username",username)
//                        .param("password",password)
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void updatePasswordTestPasswordNotProvided() throws Exception  {
//        this.mvc.perform(post("/registration/update/password")
//                        .param("username",username)
//                        .param("old_password",password)
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//
//    @Test
//    public void getUserInfoTest() throws Exception  {
//    mvc.perform(post("/registration/userinfo")
//                            .header("Authorization","Bearer "+token)
//                                .accept("application/json")
//                                .contentType(MediaType.APPLICATION_JSON))
//                        .andDo(print())
//                        .andExpect(status().isOk());
//
//}
//    @Test
//    public void getUserInfoTestTokenNotProvided() throws Exception  {
//        mvc.perform(get("/registration/userinfo")
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void getUserInfoTestTokenNotValid() throws Exception  {
//        mvc.perform(get("/registration/userinfo")
//                        .header("Authorization","Bearer 1234")
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isUnauthorized())
//                .andExpect(content().string("{\"error\":\"invalid_token\",\"error_description\":\"Invalid access token: 1234\"}"));
//    }
//    @Test
//    public void updateUserTest() throws Exception  {
//        UserRequest userRequest = new UserRequest();
//        userRequest.setUsername(username);
//        userRequest.setEmail(email);
//        userRequest.setPassword(password);
//        userRequest.setToken(token);
//        userRequest.setFirstName("firstname");
//        userRequest.setLastName("lastname");
//        userRequest.setPhone("");
//        userRequest.setFa2(true);
//        userRequest.setReceiveNews(false);
//        String jsonString  = new Gson().toJson(userRequest);
//        mvc.perform(post("/registration/userinfo/update")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType(MediaType.APPLICATION_JSON)
//                        .content(jsonString))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void updateUserTestUserNotProvided() throws Exception  {
//        mvc.perform(post("/registration/userinfo/update")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType(MediaType.APPLICATION_JSON))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//
//}
