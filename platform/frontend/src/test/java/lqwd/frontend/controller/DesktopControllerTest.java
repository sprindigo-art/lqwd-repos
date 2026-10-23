package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientLnd;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.mock.mockito.MockBean;
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

public class DesktopControllerTest extends AbstractTest {

    private static Logger logger = LoggerFactory.getLogger(DesktopControllerTest.class);


    protected HttpSession mockSession;

    @MockBean
    HttpClientLnd httpClientLnd;

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
    public void testDesktopPage() throws Exception {
        mvc.perform(get("/desktop").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getInfoTest() throws Exception {

        Mockito.when(httpClientLnd.getInfo(any(String.class),any(String.class))).thenReturn("{" +
                "\"status\":200}");

        mvc.perform(post("/getinfo").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getChannelsTest() throws Exception {

        Mockito.when(httpClientLnd.getChannels(any(String.class),any(String.class))).thenReturn("{" +
                "\"status\":200}");

        mvc.perform(post("/channels").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getPeersTest() throws Exception {

        Mockito.when(httpClientLnd.getChannels(any(String.class),any(String.class))).thenReturn("{" +
                "\"status\":200}");

        mvc.perform(post("/peers").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getFeesTest() throws Exception {

        Mockito.when(httpClientLnd.getChannels(any(String.class),any(String.class))).thenReturn("{" +
                "\"status\":200}");

        mvc.perform(post("/fees").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getWalletBalanceTest() throws Exception {

        Mockito.when(httpClientLnd.getChannels(any(String.class),any(String.class))).thenReturn("{" +
                "\"status\":200}");

        mvc.perform(post("/walletbalance").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getRecoveryInfoTest() throws Exception {

        Mockito.when(httpClientLnd.getChannels(any(String.class),any(String.class))).thenReturn("{" +
                "\"status\":200}");

        mvc.perform(post("/getrecoveryinfo").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getCheckBalanceTest() throws Exception {

        Mockito.when(httpClientLnd.getChannels(any(String.class),any(String.class))).thenReturn("{" +
                "\"status\":200}");

        mvc.perform(post("/channelbalance").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getAnalyticsTest() throws Exception {

        mvc.perform(get("/analytics").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }


}
