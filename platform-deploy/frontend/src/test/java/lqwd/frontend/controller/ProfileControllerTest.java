package lqwd.frontend.controller;

import com.google.gson.Gson;
import lqwd.frontend.httpclient.HttpClientToken;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.json.JsonContent;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import javax.servlet.http.HttpSession;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.http.MediaType.APPLICATION_FORM_URLENCODED;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.http.MediaType.APPLICATION_JSON_UTF8;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

public class ProfileControllerTest extends AbstractTest {

    private static Logger logger = LoggerFactory.getLogger(ProfileControllerTest.class);


    protected HttpSession mockSession;

    @Override
    @Before
    public void setUp() {
        super.setUp();
        try {
            mockSession = login();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Test
    public void profileViewTest() throws Exception {
        mvc.perform(get("/profile").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("profile/user_profile"));
    }

    @Test
    public void accountSettingTest() throws Exception {
        mvc.perform(get("/account-settings").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("settings/account_settings"));
    }

    @Test
    public void generateApiKeyTest() throws Exception {
        mvc.perform(post("/generate-api-key").session((MockHttpSession) mockSession).
                contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .characterEncoding("UTF-8")
                        .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                                new BasicNameValuePair("password", "tlnd3@lqwd.money")
                        )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void resetPasswordTest() throws Exception {
        mvc.perform(post("/resetpassword").session((MockHttpSession) mockSession).
                contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("curr_pass", "tlnd3@lqwd.money"),
                        new BasicNameValuePair("new_pass", "tlnd3@lqwd.money"),
                        new BasicNameValuePair("new_pass_confirm", "tlnd3@lqwd.money")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void updateProfileTest() throws Exception {
        mvc.perform(post("/account-settings/update")
                .session((MockHttpSession) mockSession).contentType(APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("firstName", "john"),
                        new BasicNameValuePair("lastName","Doe"),
                        new BasicNameValuePair("phone","2348176267145"),
                        new BasicNameValuePair("receiveNews","true"),
                        new BasicNameValuePair("email","tlnd3@lqwd.money"),
                        new BasicNameValuePair("username","test22")
                )))))
                .andExpect(status().isOk());
    }




    @Test
    public void testUpdate2fa() throws Exception {
        mvc.perform(post("/update/f2a-setting")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("password", "tlnd3@lqwd.money")
                )))).session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }


    @Test
    public void testUpdate2faOff() throws Exception {
        mvc.perform(post("/update/f2a-setting/off")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("password", "tlnd3@lqwd.money")
                )))).session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void receiveNewsON() throws Exception {
        mvc.perform(post("/update/receive-news/on").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view()
                        .name("settings/account_settings :: #account-settings"));


    }

    @Test
    public void receiveNewsOff() throws Exception {
        mvc.perform(post("/update/receive-news/off").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view()
                        .name("settings/account_settings :: #account-settings"));


    }

    @Test
    public void apiKeyListTest() throws Exception {
        mvc.perform(get("/update/api-key-list").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view()
                        .name("profile/api_key_list::api_key_table"));


    }

    @Test
    public void qrCode() throws Exception {
        mvc.perform(get("/qrcode").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view()
                        .name("auth/qrcode"));


    }

    @Test
    public void authenticateTest() throws Exception {
        mvc.perform(post("/account-settings/authenticate")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("email", "tlnd3@lqwd.money"),
                        new BasicNameValuePair("password", "tlnd3@lqwd.money")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }


}
