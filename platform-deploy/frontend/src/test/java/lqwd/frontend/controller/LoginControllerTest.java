package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientToken;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import javax.servlet.http.HttpSession;
import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

public class LoginControllerTest extends AbstractTest {

    private static Logger logger = LoggerFactory.getLogger(LoginControllerTest.class);


    protected HttpSession mockSession;
    @SpyBean
    HttpClientToken httpClientToken;

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
    public void testLoginView() throws Exception {
        mvc.perform(get("/login"))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void testLoginRedirect() throws Exception {
        mvc.perform(get("/login").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().is3xxRedirection());
    }


    @Test
    public void testDashboard() throws Exception {
        mvc.perform(get("/dashboard").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void testForgotPassword() throws Exception {

        mvc.perform(get("/forgot-password"))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void testRecovery() throws Exception {
        Mockito.when(httpClientToken.passwordRecovery(any(String.class))).thenReturn("success");
        mvc.perform(post("/recovery")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("email", "testuser11@lqwd.money")
                )))))
                .andDo(print())
                .andExpect(status().is3xxRedirection())
                .andExpect(view().name("redirect:/login"));
    }

    @Test
    public void testEmailVerification() throws Exception {
        //need to figure out how to have session info passed through tests
        mvc.perform(get("/email-verification"))
                .andDo(print())
                .andExpect(status().is3xxRedirection());
    }

    @Test
    public void testChangePassword() throws Exception {

        Mockito.doReturn("success").when(httpClientToken).changePassword(any(String.class), any(String.class), any(String.class));

        mvc.perform(post("/change-password").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("email", "testuser11@lqwd.money"),
                        new BasicNameValuePair("password", "testuser11@lqwd.money"),
                        new BasicNameValuePair("confirm-password", "testuser11@lqwd.money"),
                        new BasicNameValuePair("token", "test")
                )))))
                .andDo(print())
                .andExpect(status().is3xxRedirection())
                .andExpect(model().attribute("message", "Successfully Updated Password"))
                .andExpect(view().name("redirect:/login"));
    }

    @Test
    public void changePasswordNotMatchTest() throws Exception {

        Mockito.doReturn("success").when(httpClientToken).changePassword(any(String.class), any(String.class), any(String.class));

        mvc.perform(post("/change-password").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("email", "testuser11@lqwd.money"),
                        new BasicNameValuePair("password", "testuser11@lqwd.money"),
                        new BasicNameValuePair("confirm-password", "testuser1@lqwd.money"),
                        new BasicNameValuePair("token", "test")
                )))))
                .andDo(print())
                .andExpect(status().is3xxRedirection())
                .andExpect(model().attribute("message", "Failed to Updated Password"))
                .andExpect(view().name("redirect:/login"));
    }

    @Test
    public void testCheckUsername() throws Exception {

        MvcResult result = mvc.perform(post("/check-username")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("username", "testuser11@lqwd.money")
                )))))
                .andDo(print())
                .andExpect(status().isBadRequest())
                .andReturn();

        assertEquals(result.getResponse().getContentAsString(), "Username Used");

        result = mvc.perform(post("/check-username")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("username", "DefinitleyNotUsed@lqwd.money")
                )))))
                .andDo(print())
                .andExpect(status().isOk())
                .andReturn();

        assertEquals(result.getResponse().getContentAsString(), "Username OK");
    }

    @Test
    public void testCheckEmail() throws Exception {

        mvc.perform(post("/check-email")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("email", "FakeTestUser1234@lqwd.money")
                )))))
                .andDo(print())
                .andExpect(status().isOk())
                .andReturn();


        //when username is able to be saved
        mvc.perform(post("/check-email")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("email", "testuser11@lqwd.money")
                )))))
                .andDo(print())
                .andExpect(status().isBadRequest())
                .andReturn();

    }

    @Test
    public void testError() throws Exception {
        mvc.perform(get("/error"))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("error/404"));
    }

    @Test
    public void testLogout() throws Exception {
        mvc.perform(get("/signout").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/login"));
    }
}
