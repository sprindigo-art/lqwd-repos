package com.lqwd.security.oauth2.config.utils;

import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.model.security.User_Details;
import org.junit.jupiter.api.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit4.SpringRunner;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@RunWith(SpringRunner.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class JwtTokenUtilTest {

    @Autowired
    JwtTokenUtil jwtTokenUtil;


    @Test
    void generateToken() {
        String username = "aziz";
        User_ user = new User_(username, "test1");
        String token = jwtTokenUtil.generateToken(user);

        final String getUsername = jwtTokenUtil.getUsernameFromToken(token);

        assertEquals(user.getUsername(), getUsername);

        Date nowDate = new Date();
        Date exDate =jwtTokenUtil.getExpirationDateFromToken(token);
        long seconds = (exDate.getTime()-nowDate.getTime())/1000;
        assertTrue( seconds > 1000L );

        assertTrue(jwtTokenUtil.validateToken(token, user));
    }


}