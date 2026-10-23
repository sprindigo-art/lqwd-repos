//package com.lqwd.security.oauth2.controller;
//
//import com.lqwd.security.oauth2.model.request.RegistrationRequest;
//import com.lqwd.security.oauth2.model.security.User_;
//import com.lqwd.security.oauth2.service.UserService;
//import org.apache.http.HttpHeaders;
//import org.json.JSONArray;
//import org.json.JSONObject;
//import org.junit.Before;
//import org.junit.Test;
//import org.junit.runner.RunWith;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.beans.factory.annotation.Value;
//import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
//import org.springframework.boot.test.context.SpringBootTest;
//import org.springframework.http.MediaType;
//import org.springframework.test.context.junit4.SpringJUnit4ClassRunner;
//import org.springframework.test.web.servlet.MockMvc;
//
//import java.util.Map;
//
//import static org.assertj.core.api.Assertions.assertThat;
//import static org.hamcrest.Matchers.containsString;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
//import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
//
//
//
//@SpringBootTest
//@AutoConfigureMockMvc
//@RunWith(SpringJUnit4ClassRunner.class)
//public class ApiKeyControllerTest {
//    @Autowired
//    private ApiKeyController apiKeyController;
//    @Autowired
//    private MockMvc mvc;
//
//    @Autowired
//    private RegistrationController registrationController;
//    @Autowired
//    UserService userService;
//    @Value("${app.appusername}")
//    private String appusername;
//     @Value("${app.apppassword}")
//    private String apppassword;
//    String lndNodeName = "";
//    private String apikey="";
//    private String apikeyDeactivate;
//    private String username = "tlnd6@lqwd.money";
//    private String password = "tlnd6@lqwd.money";
//    private String email = "tlnd6@lqwd.money";
//    String token = "";
//    String encoding = java.util.Base64.getEncoder().encodeToString((appusername+":"+apppassword).getBytes());
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
//        token = getAccessTokenTest();
//        System.out.println("token: "+token);
//        createApikeyTest();
//        createApikeyTest();
//        apikey = getApiKeyString(0);
//        apikeyDeactivate = getApiKeyString(1);
//    }
//    public String getApiKeyString(int index) throws Exception {
//        String response  = mvc.perform(post("/apikey/getlist")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded"))
//                .andDo(print())
//                .andExpect(status().isOk())
//                .andReturn().getResponse().getContentAsString();
//            JSONObject jsonObject = new JSONObject(response);
//            if(jsonObject.has("apikey")){
//                JSONArray jsonArray = new JSONArray(jsonObject.getString("apikey"));
//                System.out.println("------------------------ jsonArray(0) "+jsonArray.getJSONObject(index).get("apikey"));
//                apikey = jsonArray.getJSONObject(index).getString("apikey");
//            }
//        return apikey;
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
//    public void apiKeyInfoTest() throws Exception {
//        mvc.perform(get("/apikey/authorize")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .param("apikey",apikey))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void apiKeyInfoTestApiKeyNotProvided() throws Exception {
//        mvc.perform(get("/apikey/authorize")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void checkApikeyTest() throws Exception {
//        mvc.perform(post("/apikey/check")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .param("apikey",apikey)
//                        .param("lndNodeName",lndNodeName))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void checkApikeyTestApiKeyNotProvided() throws Exception {
//        mvc.perform(post("/apikey/check")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .param("lndNodeName",lndNodeName))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(status().reason(containsString("Required String parameter 'apikey' is not present")));
//    }
//    @Test
//    public void deactivateApikeyTest() throws Exception {
//        mvc.perform(post("/apikey/deactivate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("apikey",apikeyDeactivate)
//                        .param("password",password)
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void deactivateApikeyTestApiKeyNotProvided() throws Exception {
//        mvc.perform(post("/apikey/deactivate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("password",password)
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(status().reason(containsString("Required String parameter 'apikey' is not present")));
//    }
//    @Test
//    public void deactivateApikeyTestUsernameNotExist() throws Exception {
//        mvc.perform(post("/apikey/deactivate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("apikey",apikey)
//                        .param("password",password)
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isUnauthorized());
//    }
//    @Test
//    public void deactivateApikeyTestPasswordNotProvided() throws Exception {
//        mvc.perform(post("/apikey/deactivate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("apikey",apikey)
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(status().reason(containsString("Required String parameter 'password' is not present")));
//    }
//    @Test
//    public void deactivateApikeyTestUsernameNotProvided() throws Exception {
//        mvc.perform(post("/apikey/deactivate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("apikey",apikey)
//                        .param("password",password))
//                .andDo(print())
//                .andExpect(status().isBadRequest())
//                .andExpect(status().reason(containsString("Required String parameter 'username' is not present")));
//    }
//    @Test
//    public void addoneTest() throws Exception {
//        mvc.perform(post("/apikey/addone")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .param("apikey",apikey))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void addoneTestApiKeyNotProvided() throws Exception {
//        mvc.perform(post("/apikey/addone")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json"))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void createApikeyTest() throws Exception {
//        mvc.perform(post("/apikey/generate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("password",password)
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void createApikeyTestPasswordNotProvided() throws Exception {
//        mvc.perform(post("/apikey/generate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("username",username))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void createApikeyTestUsernameNotProvided() throws Exception {
//        mvc.perform(post("/apikey/generate")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded")
//                        .param("password",password))
//                .andDo(print())
//                .andExpect(status().isBadRequest());
//    }
//    @Test
//    public void getApikeysTest() throws Exception {
//        mvc.perform(post("/apikey/getlist")
//                        .header("Authorization","Bearer "+token)
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded"))
//                .andDo(print())
//                .andExpect(status().isOk());
//    }
//    @Test
//    public void getApikeysTestAuthNotProvided() throws Exception {
//        mvc.perform(post("/apikey/getlist")
//                        .header("Authorization","Bearer ")
//                        .accept("application/json")
//                        .contentType("application/x-www-form-urlencoded"))
//                .andDo(print())
//                .andExpect(status().isUnauthorized());
//    }
//}
//
//
//
//
//
