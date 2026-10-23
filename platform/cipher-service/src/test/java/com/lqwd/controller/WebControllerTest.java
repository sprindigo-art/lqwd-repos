package com.lqwd.controller;

import com.lqwd.DefaultTestConfiguration;
import com.lqwd.repository.CipherMethodRepository;
import com.lqwd.repository.CipherMethodUpdateRepository;
import com.lqwd.repository.LndFileRepository;
import com.lqwd.repository.SecretKeyChangeLogRepository;
import com.lqwd.service.CipherService;
import com.lqwd.service.KubenetesService;
import com.lqwd.service.OauthService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit4.SpringJUnit4ClassRunner;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;

@RunWith(SpringJUnit4ClassRunner.class)
@WebMvcTest(controllers=WebController.class, properties={
        "app.resource_id=resource-server-rest-api" ,
        "app.cipher_asd=envelope_example",
        "spring.profiles.active=test",
        "app.auth_user_name=aa" ,
        "app.auth_password=aa",
        "app.kubernetes.config.token=aa" ,
        "app.kubernetes.config.cert_data=aa"
})
@TestPropertySource(properties = {"WENV=development"})
@Import(DefaultTestConfiguration.class)
public class WebControllerTest {
    @Autowired
    MockMvc mvc;

    @MockBean
    CipherMethodRepository cipherMethodRepository;

    @MockBean
    SecretKeyChangeLogRepository secretKeyChangeLogRepository;

    @MockBean
    CipherMethodUpdateRepository cipherMethodUpdateRepository;

    @MockBean
    LndFileRepository lndFileRepository;


    @MockBean
    CipherService cipherService;

    @MockBean
    OauthService oauthService;

    @MockBean
    KubenetesService kubenetesService;

    @Test
    public void testIndexPageLoaded() throws Exception {
        mvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(view().name("index"));
    }

}
