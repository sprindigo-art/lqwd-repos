package com.lqwd.security.oauth2.oauthmvc;


import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.runner.RunWith;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.web.server.LocalServerPort;
import org.springframework.http.*;

import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;


import java.net.URL;


import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class OAuthMvcTest {

//    @Value("${app.auth_post_url}")
//    private String appAuthPostUrl;
//
//    @Value("${app.auth_password}")
//    private String appAuthPassword;
//
//    @Value("${app.auth_user_name}")
//    private String appAuthUserName;
//
//    @Value("${app.auth_post_port}")
//    private String appAuthPostPort;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void oauthToken() throws Exception {
        ResultActions result = this.mockMvc.perform(get("/oauth/token"))
                .andDo(print())
                .andExpect(status().isUnauthorized());


        MockHttpServletRequestBuilder builder = MockMvcRequestBuilders.get("/oauth/token")
                .contentType("application/x-www-form-urlencoded")
                .accept("*/*")
                .content("username=admin&password=admin1234&grant_type=password&client_id=spring-security-oauth2-read-write-client");



        ResultActions result2 = this.mockMvc.perform(builder);


        result.andExpect(content().string(containsString("")));
    }



//    header 'Accept: application/json' \
//            --header 'Content-Type: application/x-www-form-urlencoded' \
//            --header 'Authorization: Basic c3ByaW5nLXNlY3VyaXR5LW9hdXRoMi1yZWFkLXdyaXRlLWNsaWVudDpzcHJpbmctc2VjdXJpdHktb2F1dGgyLXJlYWQtd3JpdGUtY2xpZW50LXBhc3N3b3JkMTIzNA==' \
//            --data-urlencode 'username=admin' \
//            --data-urlencode 'password=admin1234' \
//            --data-urlencode 'grant_type=password' \
//            --data-urlencode 'client_id=spring-security-oauth2-read-write-client'

    @BeforeEach
    void setUp() {
    }

    @AfterEach
    void tearDown() {
    }



//    @Test
//    void getInfo() throws Exception {
//
//        String token = "50aebe9e-db4e-4aa5-864c-490a438e69a2";
//        HttpHeaders headers = new HttpHeaders();
//        headers.set(HttpHeaders.AUTHORIZATION, "Bearer " + token );
//        headers.set(HttpHeaders.ACCEPT, "application/json");
//
//        HttpEntity<String> entity = new HttpEntity<>("body", headers);
//
//        ResponseEntity<String> response = restTemplate.exchange(
//                new URL("http://localhost:" + port + "/lnd/info").toString(), HttpMethod.POST, entity, String.class);
//        assertEquals ("Tmessage successfully sent to Kafka", response.getBody());
//
//    }


}
