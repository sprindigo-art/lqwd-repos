package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.model.LndNode;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;

import javax.servlet.http.HttpSession;
import java.util.ArrayList;
import java.util.Arrays;

import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;

public class PaymentControllerTest extends AbstractTest {


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
    public void paymentsTest() throws Exception {
        mvc.perform(get("/payments").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("payment/payment"));
    }

    @Test
    public void getInvoiceFragment() throws Exception {

        mvc.perform(get("/get-invoice-frag").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("payment/fragments/invoices::invoicesFrag"));
    }

    @Test
    public void getTransactionsFrag() throws Exception {

        mvc.perform(get("/get-transactions-frag").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("payment/fragments/transactions::transactionsFrag"));
    }

    @Test
    public void createInvoiceTest() throws Exception {

        Mockito.when(httpClientLnd.createInvoice(any(String.class), any(String.class)
                ,any(int.class), any(String.class))).thenReturn("{\"payment_request\":\"test123\",\"r_hash\":\"testrhash\"}");

        mvc.perform(post("/create-invoice").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4"),
                        new BasicNameValuePair("amount", "10000")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void sendPaymentTest() throws Exception {

        Mockito.when(httpClientLnd.getPaymentDetails(any(String.class), any(String.class)
                ,any(String.class))).thenReturn("{\"payment_request\":\"test123\",\"destination\":\"tlnd4\"}");

        Mockito.when(httpClientLnd.sendPayment(any(String.class), any(String.class)
                ,any(String.class),any(String.class),any(String.class))).thenReturn("{\"payment_request\":\"test123\",\"destination\":\"tlnd4\"}");

        mvc.perform(post("/send-payment").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("lnd_name", "tlnd4"),
                        new BasicNameValuePair("amount", "10000"),
                        new BasicNameValuePair("pay_req", "tyuuiii")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }



    @Test
    public void paymentLookupTest() throws Exception {
        mvc.perform(get("/payment-lookup")
                .session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("payment/payment-request"));

    }

    @Test
    public void getPaymentDetailsTest() throws Exception {
        LndNode node = new LndNode();
        node.setLndNodeName("tlnd4");

        ArrayList<LndNode> res = new ArrayList<>();
        res.add(node);
        res.add(node);

        Mockito.doReturn(res).when(httpClientLnd).getLndNodeList(any(String.class));

        Mockito.doReturn("{\"payment_request\":\"test123\",\"destination\":\"tlnd4\"}").when(httpClientLnd)
                .getPaymentDetails(any(String.class), any(String.class)
                ,any(String.class));


        mvc.perform(get("/get-payment-details").param("pay_req","test22")
                .session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("payment/fragments/payment-details"));

    }

    @Test
    public void getPaymentRequestQrcodeTest() throws Exception {
        mvc.perform(get("/get-payreq-qrcode").param("payreq","test22")
                .session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());

    }




}
