package lqwd.frontend.controller;

import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.junit.Before;
import org.junit.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;

import javax.servlet.http.HttpSession;
import java.util.Arrays;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;

public class AccountingControllerTest extends AbstractTest {

    private static Logger logger = LoggerFactory.getLogger(AccountingControllerTest.class);


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
    public void accountInfoPageTest() throws Exception {
        mvc.perform(get("/account-info").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("profile/account_info"));
    }

    @Test
    public void requestAccountingTest() throws Exception {
        mvc.perform(get("/request-accounting").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("requests/request_history"));
    }

    @Test
    public void detailedHistoryTest() throws Exception {
        mvc.perform(get("/detailed-history").param("pubkey","test").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("requests/detailed_history"));
    }



    @Test
    public void changeCurrencyTest() throws Exception {
        mvc.perform(post("/change-currency").session((MockHttpSession) mockSession).
                contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .characterEncoding("UTF-8")
                        .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                                new BasicNameValuePair("currency", "USD")
                        )))))
                .andDo(print())
                .andExpect(status().isOk());
    }



}
