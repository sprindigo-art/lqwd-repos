package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.model.BitcoinPrice;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.mock.web.MockHttpSession;

import javax.servlet.http.HttpSession;

import java.util.ArrayList;

import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;

public class TransactionControllerTest extends AbstractTest {


    protected HttpSession mockSession;

    @SpyBean
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
    public void transactionsTest() throws Exception {
        mvc.perform(get("/transactions").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("transactions/transaction-details"));
    }

    @Test
    public void getTransactionDetailsTest() throws Exception {

        Mockito.when(httpClientLnd.getAllTransactionsByNode(any(String.class),any(String.class)
                ,any(String.class),any(BitcoinPrice.class))).thenReturn(new ArrayList<>());

        mvc.perform(get("/get-transaction-details").param("lnd_name","test")
                .param("tx_hash","trx").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("transactions/fragments/transaction-details-content"));
    }

    @Test
    public void requestAccountingTest() throws Exception {
        mvc.perform(get("/get-transactions").param("lnd_name","tlnd4").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }


}
