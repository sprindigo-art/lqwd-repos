package com.lqwd.security.oauth2.controller;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
public class SmokeTest {

    @Autowired
    private AuthorizedController authorizedController;

    @Test
    public void contextLoads() throws Exception{
        assertThat(authorizedController).isNotNull();
    }
}
