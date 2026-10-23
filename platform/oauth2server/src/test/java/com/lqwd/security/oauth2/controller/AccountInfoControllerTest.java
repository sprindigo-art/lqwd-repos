//package com.lqwd.security.oauth2.controller;
//
//import com.lqwd.security.oauth2.model.request.RegistrationRequest;
//import com.lqwd.security.oauth2.model.response.AccountInfoResponse;
//import com.lqwd.security.oauth2.model.security.User_;
//import com.lqwd.security.oauth2.service.UserService;
//import org.apache.http.HttpHeaders;
//import org.json.JSONObject;
//import org.junit.Before;
//import org.junit.Test;
//import org.junit.runner.RunWith;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
//import org.springframework.boot.test.context.SpringBootTest;
//import org.springframework.http.MediaType;
//import org.springframework.test.context.junit4.SpringJUnit4ClassRunner;
//import org.springframework.test.web.servlet.MockMvc;
//import org.springframework.test.web.servlet.ResultActions;
//import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
//
//import static org.assertj.core.api.Assertions.assertThat;
//import static org.hamcrest.Matchers.containsString;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
//import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
//import org.springframework.beans.factory.annotation.Value;
//
//@SpringBootTest
//@AutoConfigureMockMvc
//@RunWith(SpringJUnit4ClassRunner.class)
//public class AccountInfoControllerTest {
//    @Autowired
//    private AccountInfoController accountInfoController;
//    @Autowired
//    private MockMvc mvc;
//    @Autowired
//    private RegistrationController registrationController;
//    @Autowired
//    UserService userService;
//
//    @Value("${app.appusername}")
//    private String appusername ;
//    @Value("${app.apppassword}")
//    private String apppassword ;
//
//    private String username = "tlnd6@lqwd.money";
//    private String password = "tlnd6@lqwd.money";
//    private String email = "tlnd6@lqwd.money";
//    String token = "";
//   String encoding = java.util.Base64.getEncoder().encodeToString((appusername+":"+apppassword).getBytes());
//    @Before
//    public void setup() throws Exception {
//        User_ user_ = userService.findByUsername(username);
//        if(user_==null){
//            RegistrationRequest registrationRequest = RegistrationRequest.builder()
//                    .username(username)
//                    .email(username)
//                    .password(username)
//                    .firstname("firstname")
//                    .lastname("lastname")
//                    .companyName("companyName")
//                    .serviceName("lnd-advanced-processing-send-message")
//                    .f2a(true)
//                    .build();
//            registrationController.registrationV2(registrationRequest);
//        }
//          token = getAccessTokenTest();
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
//        JSONObject jsonObject = new JSONObject(response);
//        if(!jsonObject.getString("access_token").isEmpty()){
//            token = jsonObject.getString("access_token");
//        }
//        return token;
//    }
//    @Test
//    public void getInfoTest() throws Exception {
//        this.mvc.perform(post("/account/getinfo")
//                        .param("token",token))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void getInfoTestTokenNotProvided() throws Exception {
//        this.mvc.perform(post("/account/getinfo"))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(status().reason(containsString("Required String parameter 'token' is not present")));
//    }
//}
