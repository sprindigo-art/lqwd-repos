package com.lqwd.security.oauth2.controller;

import com.lqwd.security.oauth2.config.utils.JwtTokenUtil;
import com.lqwd.security.oauth2.model.request.JwtRequest;

import com.lqwd.security.oauth2.service.UserService;
import org.junit.Before;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.containsString;

import org.springframework.test.web.servlet.MockMvc;



@SpringBootTest
@AutoConfigureMockMvc
public class AuthorizedControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserService userService;

    @Autowired
    JwtTokenUtil jwtTokenUtil;


    private JwtRequest jwtRequest;

    @Before
    public void setup() {
    }


    @Test
    void createAuthenticationToken()  throws Exception  {
        this.mockMvc.perform(get("/")).andDo(print()).andExpect(status().isOk())
                .andExpect(content().string(containsString("LQWD Financial Corp")));


    }


    @Test
    public void chekToken_test() throws Exception {
    }

    @BeforeEach
    void setUp() {
    }

    @AfterEach
    void tearDown() {
    }




    @org.junit.jupiter.api.Test
    void getAuthorizeToken() {
    }
}
