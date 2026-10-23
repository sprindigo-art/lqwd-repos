package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.LndChannel;
import lqwd.frontend.model.LndNode;
import lqwd.frontend.model.LndNodeInfo;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import javax.servlet.http.HttpSession;
import java.util.ArrayList;
import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.model;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;

public class LndControllerTest extends AbstractTest {

    private static Logger logger = LoggerFactory.getLogger(LndControllerTest.class);


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
    public void lndNodePageTest() throws Exception {
        mvc.perform(get("/lnd-node").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_dashboard/lnd_dashboard"));
    }

    @Test
    public void lndChannelsTest() throws Exception {
        mvc.perform(get("/lnd-channels").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_channels/lnd_channels"));
    }

    @Test
    public void getActiveChannelsTest() throws Exception {
        mvc.perform(get("/get-active-channels").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_channels/fragments/lnd_channel_card::lnd_active_channels"));
    }

    @Test
    public void getInActiveChannelsTest() throws Exception {
        mvc.perform(get("/get-inactive-channels").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_channels/fragments/lnd_channel_card::lnd_inactive_channels"));
    }

    @Test
    public void getPendingChannelsTest() throws Exception {
        mvc.perform(get("/get-pending-channels").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_channels/fragments/lnd_channel_card::lnd_pending_channels"));
    }

    @Test
    public void channelDetailsTest() throws Exception {
        LndNodeInfo lndNodeInfo = new LndNodeInfo();
        lndNodeInfo.setVersion("v1");
        lndNodeInfo.setCommit_hash("test_hash");
        lndNodeInfo.setIdentity_pubkey("pub_test");
        lndNodeInfo.setAlias("tlnd4");
        lndNodeInfo.setNum_pending_channels(1);
        lndNodeInfo.setNum_active_channels(2);
        lndNodeInfo.setNum_inactive_channels(3);
        lndNodeInfo.setNum_peers(4);
        lndNodeInfo.setBlock_height(4);
        lndNodeInfo.setBlock_hash("block hash");

        LndChannel channel = new LndChannel();
        channel.setActive(false);
        channel.setRemote_pubkey("test");
        channel.setRemote_node_pub("test");
        channel.setChannel_point("test");
        channel.setChan_id("ini1");
        channel.setCapacity("100");
        channel.setLocal_balance("100");
        channel.setRemote_balance("100");
        channel.setCommit_fee("100");
        channel.setCommit_weight("1");
        channel.setFee_per_kw("12");
        channel.setUnsettled_balance("100");
        channel.setTotal_satoshis_sent("1");
        channel.setTotal_satoshis_received("2");
        channel.setInitiator(true);

        ArrayList<LndChannel> list = new ArrayList<>();
        list.add(channel);

        Mockito.when(httpClientLnd.getLndChannelList(any(String.class),any(String.class)))
                .thenReturn(list);

        Mockito.when(httpClientLnd.getLndNodeInfo(any(String.class),any(String.class)))
                .thenReturn(lndNodeInfo);
        mvc.perform(get("/channel-details").param("channel_id","ini1")
                .param("lnd_name","tlnd4").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_channels/channels_details"));
    }

    @Test
    public void getNodeListInfo() throws Exception {
        LndNodeInfo lndNodeInfo = new LndNodeInfo();
        lndNodeInfo.setVersion("v1");
        lndNodeInfo.setCommit_hash("test_hash");
        lndNodeInfo.setIdentity_pubkey("pub_test");
        lndNodeInfo.setAlias("tlnd4");
        lndNodeInfo.setNum_pending_channels(1);
        lndNodeInfo.setNum_active_channels(2);
        lndNodeInfo.setNum_inactive_channels(3);
        lndNodeInfo.setNum_peers(4);
        lndNodeInfo.setBlock_height(4);
        lndNodeInfo.setBlock_hash("block hash");

        LndChannel channel = new LndChannel();
        channel.setActive(false);
        channel.setRemote_pubkey("test");
        channel.setRemote_node_pub("test");
        channel.setChannel_point("test");
        channel.setChan_id("ini1");
        channel.setCapacity("100");
        channel.setLocal_balance("100");
        channel.setRemote_balance("100");
        channel.setCommit_fee("100");
        channel.setCommit_weight("1");
        channel.setFee_per_kw("12");
        channel.setUnsettled_balance("100");
        channel.setTotal_satoshis_sent("1");
        channel.setTotal_satoshis_received("2");
        channel.setInitiator(true);

        ArrayList<LndChannel> list = new ArrayList<>();
        list.add(channel);

        LndNode lndNode = new LndNode();
        lndNode.setLndNodeName("tlnd4");
        lndNode.setExternalip("10.11.34.18");
        lndNode.setActiveChannels(list);
        lndNode.setPendingChannels(new ArrayList<LndChannel>());
        lndNode.setClosedChannels(new ArrayList<LndChannel>());
        lndNode.setStatus("ACTIVE");
        lndNode.setDescription("The test");
        lndNode.setPort("8080");
        //lndNode.setWalletBalance(1000L);
        lndNode.setLndNodeInfo(lndNodeInfo);

        ArrayList<LndNode> nodeList = new ArrayList<>();
        nodeList.add(lndNode);

        Mockito.when(httpClientLnd.getLndNodeList(any(String.class)))
                .thenReturn(nodeList);


        mvc.perform(get("/get-node-list").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_dashboard/fragments/lnd_node_card::lnd_node_card"));
    }


    @Test
    public void manageNodeTest() throws Exception {
        LndNodeInfo lndNodeInfo = new LndNodeInfo();
        lndNodeInfo.setVersion("v1");
        lndNodeInfo.setCommit_hash("test_hash");
        lndNodeInfo.setIdentity_pubkey("pub_test");
        lndNodeInfo.setAlias("tlnd4");
        lndNodeInfo.setNum_pending_channels(1);
        lndNodeInfo.setNum_active_channels(2);
        lndNodeInfo.setNum_inactive_channels(3);
        lndNodeInfo.setNum_peers(4);
        lndNodeInfo.setBlock_height(4);
        lndNodeInfo.setBlock_hash("block hash");

        LndChannel channel = new LndChannel();
        channel.setActive(false);
        channel.setRemote_pubkey("test");
        channel.setRemote_node_pub("test");
        channel.setChannel_point("test");
        channel.setChan_id("ini1");
        channel.setCapacity("100");
        channel.setLocal_balance("100");
        channel.setRemote_balance("100");
        channel.setCommit_fee("100");
        channel.setCommit_weight("1");
        channel.setFee_per_kw("12");
        channel.setUnsettled_balance("100");
        channel.setTotal_satoshis_sent("1");
        channel.setTotal_satoshis_received("2");
        channel.setInitiator(true);

        ArrayList<LndChannel> list = new ArrayList<>();
        list.add(channel);

        LndNode lndNode = new LndNode();
        lndNode.setLndNodeName("tlnd4");
        lndNode.setExternalip("10.11.34.18");
        lndNode.setActiveChannels(list);
        lndNode.setPendingChannels(new ArrayList<LndChannel>());
        lndNode.setClosedChannels(new ArrayList<LndChannel>());
        lndNode.setStatus("ACTIVE");
        lndNode.setDescription("The test");
        lndNode.setPort("8080");
        //lndNode.setWalletBalance("1000");
        lndNode.setLndNodeInfo(lndNodeInfo);

        ArrayList<LndNode> nodeList = new ArrayList<>();
        nodeList.add(lndNode);

        Mockito.when(httpClientLnd.getLndNodeList(any(String.class)))
                .thenReturn(nodeList);


        mvc.perform(get("/manage-nodes").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_node/manage_nodes"));
    }

    @Test
    public void getLndDetails() throws Exception {
        LndNodeInfo lndNodeInfo = new LndNodeInfo();
        lndNodeInfo.setVersion("v1");
        lndNodeInfo.setCommit_hash("test_hash");
        lndNodeInfo.setIdentity_pubkey("pub_test");
        lndNodeInfo.setAlias("tlnd4");
        lndNodeInfo.setNum_pending_channels(1);
        lndNodeInfo.setNum_active_channels(2);
        lndNodeInfo.setNum_inactive_channels(3);
        lndNodeInfo.setNum_peers(4);
        lndNodeInfo.setBlock_height(4);
        lndNodeInfo.setBlock_hash("block hash");

        LndChannel channel = new LndChannel();
        channel.setActive(false);
        channel.setRemote_pubkey("test");
        channel.setRemote_node_pub("test");
        channel.setChannel_point("test");
        channel.setChan_id("ini1");
        channel.setCapacity("100");
        channel.setLocal_balance("100");
        channel.setRemote_balance("100");
        channel.setCommit_fee("100");
        channel.setCommit_weight("1");
        channel.setFee_per_kw("12");
        channel.setUnsettled_balance("100");
        channel.setTotal_satoshis_sent("1");
        channel.setTotal_satoshis_received("2");
        channel.setInitiator(true);

        ArrayList<LndChannel> list = new ArrayList<>();
        list.add(channel);

        LndNode lndNode = new LndNode();
        lndNode.setLndNodeName("tlnd4");
        lndNode.setExternalip("10.11.34.18");
        lndNode.setActiveChannels(list);
        lndNode.setPendingChannels(new ArrayList<LndChannel>());
        lndNode.setClosedChannels(new ArrayList<LndChannel>());
        lndNode.setStatus("ACTIVE");
        lndNode.setDescription("The test");
        lndNode.setPort("8080");
        //lndNode.setWalletBalance("1000");
        lndNode.setLndNodeInfo(lndNodeInfo);

        ArrayList<LndNode> nodeList = new ArrayList<>();
        nodeList.add(lndNode);

        Mockito.when(httpClientLnd.getLndNode(any(String.class),any(String.class)))
                .thenReturn(lndNode);

        Mockito.when(httpClientLnd.getLndNodeInfo(any(String.class),any(String.class)))
                .thenReturn(lndNodeInfo);


        mvc.perform(get("/lnd-details").param("lnd_name","tlnd4").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_node/lnd_node-details"));
    }

    @Test
    public void lndAddressTest() throws Exception {
        LndNodeInfo lndNodeInfo = new LndNodeInfo();
        lndNodeInfo.setVersion("v1");
        lndNodeInfo.setCommit_hash("test_hash");
        lndNodeInfo.setIdentity_pubkey("pub_test");
        lndNodeInfo.setAlias("tlnd4");
        lndNodeInfo.setNum_pending_channels(1);
        lndNodeInfo.setNum_active_channels(2);
        lndNodeInfo.setNum_inactive_channels(3);
        lndNodeInfo.setNum_peers(4);
        lndNodeInfo.setBlock_height(4);
        lndNodeInfo.setBlock_hash("block hash");

        LndChannel channel = new LndChannel();
        channel.setActive(false);
        channel.setRemote_pubkey("test");
        channel.setRemote_node_pub("test");
        channel.setChannel_point("test");
        channel.setChan_id("ini1");
        channel.setCapacity("100");
        channel.setLocal_balance("100");
        channel.setRemote_balance("100");
        channel.setCommit_fee("100");
        channel.setCommit_weight("1");
        channel.setFee_per_kw("12");
        channel.setUnsettled_balance("100");
        channel.setTotal_satoshis_sent("1");
        channel.setTotal_satoshis_received("2");
        channel.setInitiator(true);

        ArrayList<LndChannel> list = new ArrayList<>();
        list.add(channel);

        LndNode lndNode = new LndNode();
        lndNode.setLndNodeName("tlnd4");
        lndNode.setExternalip("10.11.34.18");
        lndNode.setActiveChannels(list);
        lndNode.setPendingChannels(new ArrayList<LndChannel>());
        lndNode.setClosedChannels(new ArrayList<LndChannel>());
        lndNode.setStatus("ACTIVE");
        lndNode.setDescription("The test");
        lndNode.setPort("8080");
        //lndNode.setWalletBalance("1000");
        lndNode.setLndNodeInfo(lndNodeInfo);

        ArrayList<LndNode> nodeList = new ArrayList<>();
        nodeList.add(lndNode);

        Mockito.when(httpClientLnd.getLndNodeList(any(String.class)))
                .thenReturn(nodeList);

        mvc.perform(get("/lnd-address").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_address/lnd-address"));
    }

    @Test
    public void createAddressTest() throws Exception {

        Mockito.when(httpClientLnd.createAddress(any(String.class),any(String.class), any(String.class)))
                .thenReturn("test_address");

        mvc.perform(get("/create-address").param(
                "lnd_name","tlnd4"
        ).param("password","password").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void getAddressQrCodeTest() throws Exception {


        mvc.perform(get("/get-address-qrcode").param(
                "address","tlnd4"
        ).session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk());
    }


    @Test
    public void getWalletBalanceTest() throws Exception {
        LndNodeInfo lndNodeInfo = new LndNodeInfo();
        lndNodeInfo.setVersion("v1");
        lndNodeInfo.setCommit_hash("test_hash");
        lndNodeInfo.setIdentity_pubkey("pub_test");
        lndNodeInfo.setAlias("tlnd4");
        lndNodeInfo.setNum_pending_channels(1);
        lndNodeInfo.setNum_active_channels(2);
        lndNodeInfo.setNum_inactive_channels(3);
        lndNodeInfo.setNum_peers(4);
        lndNodeInfo.setBlock_height(4);
        lndNodeInfo.setBlock_hash("block hash");

        LndChannel channel = new LndChannel();
        channel.setActive(false);
        channel.setRemote_pubkey("test");
        channel.setRemote_node_pub("test");
        channel.setChannel_point("test");
        channel.setChan_id("ini1");
        channel.setCapacity("100");
        channel.setLocal_balance("100");
        channel.setRemote_balance("100");
        channel.setCommit_fee("100");
        channel.setCommit_weight("1");
        channel.setFee_per_kw("12");
        channel.setUnsettled_balance("100");
        channel.setTotal_satoshis_sent("1");
        channel.setTotal_satoshis_received("2");
        channel.setInitiator(true);

        ArrayList<LndChannel> list = new ArrayList<>();
        list.add(channel);

        LndNode lndNode = new LndNode();
        lndNode.setLndNodeName("tlnd4");
        lndNode.setExternalip("10.11.34.18");
        lndNode.setActiveChannels(list);
        lndNode.setPendingChannels(new ArrayList<>());
        lndNode.setClosedChannels(new ArrayList<>());
        lndNode.setStatus("active");
        lndNode.setDescription("The test");
        lndNode.setPort("8080");
        //lndNode.setWalletBalance("1000");
        lndNode.setLndNodeInfo(lndNodeInfo);

        ArrayList<LndNode> nodeList = new ArrayList<>();
        nodeList.add(lndNode);

        Mockito.when(httpClientLnd.getLndNodeList(any(String.class)))
                .thenReturn(nodeList);

        Mockito.when(httpClientLnd.getLndChannelList(any(String.class),any(String.class)))
                .thenReturn(list);

        Mockito.when(httpClientLnd.getLndNodeWalletBalance(any(String.class),any(String.class)))
                .thenReturn("{\"total_balance\":\"10000\",\"confirmed_balance\":\"200\",\"unconfirmed_balance\":\"100\"}");



        mvc.perform(get("/get-wallet-balance").session((MockHttpSession) mockSession))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(view().name("lnd_node/fragments/wallet_balance"));
    }



    @Test
    public void createNodeTest() throws Exception {

        TokenKey tokenKey = new TokenKey();
        tokenKey.setRefresh_token("test_refresh");
        tokenKey.setAccess_token("test_access");
        tokenKey.setToken_type("auth");
        tokenKey.setExpires_in(200);
        tokenKey.setRequestedSystemTime(100000L);
        tokenKey.setScope("Read");



        Mockito.when(httpClientLnd.createPersonalLNDNode(tokenKey.getAccess_token(), any(String.class),any(String.class),
                any(String.class),any(String.class),any(String.class),any(String.class),any(Boolean.class))).thenReturn("{\"test\":\"test\"}");


        mvc.perform(post("/create-node").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("password", "test_key"),
                        new BasicNameValuePair("network", "testnet")

                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void createChannelTest() throws Exception {

        Mockito.when(httpClientLnd.connectToPeer(any(String.class),any(String.class),
                any(String.class),any(String.class),any(String.class), any(String.class))).thenReturn("{\"test\":\"test\"}");

        Mockito.when(httpClientLnd.createLNDChannel(any(String.class),any(String.class),
                any(String.class),any(String.class),any(String.class),
                any(String.class),any(Integer.class),any(Boolean.class))).thenReturn("{\"test\":\"test\"}");

        Mockito.when(httpClientLnd.isJson("{\"test\":\"test\"}")).thenReturn(true);

        mvc.perform(post("/create-channel").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("node_key", "test_key"),
                        new BasicNameValuePair("local_fund_amnt", "1000.00"),
                        new BasicNameValuePair("lnd_name", "tlnd4"),
                        new BasicNameValuePair("hostname", "lqwd.money"),
                        new BasicNameValuePair("port", "8080")

                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void closeChannelTest() throws Exception {

        Mockito.when(httpClientLnd.closeChannel(any(String.class),any(String.class),
                any(String.class), any(String.class), any(boolean.class))).thenReturn("{\"test\":\"test\"}");

        Mockito.when(httpClientLnd.isJson("{\"test\":\"test\"}")).thenReturn(true);

        mvc.perform(post("/close-channel").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("password", "test_key"),
                        new BasicNameValuePair("channel_point", "1"),
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }

    @Test
    public void closeLndNode() throws Exception {
        TokenKey tokenKey = new TokenKey();
        tokenKey.setRefresh_token("test_refresh");
        tokenKey.setAccess_token("test_access");
        tokenKey.setToken_type("auth");
        tokenKey.setExpires_in(200);
        tokenKey.setRequestedSystemTime(100000L);
        tokenKey.setScope("Read");

        Mockito.when(httpClientLnd.closeLndNode(tokenKey.getAccess_token(), any(String.class),any(String.class),
                any(String.class),any(boolean.class) )).thenReturn("{\"test\":\"test\"}");

        Mockito.when(httpClientLnd.isJson("{\"test\":\"test\"}")).thenReturn(true);

        mvc.perform(post("/close-lnd-node").session((MockHttpSession) mockSession)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .characterEncoding("UTF-8")
                .content(EntityUtils.toString(new UrlEncodedFormEntity(Arrays.asList(
                        new BasicNameValuePair("password", "test_key"),
                        new BasicNameValuePair("lnd_name", "tlnd4")
                )))))
                .andDo(print())
                .andExpect(status().isOk());
    }


}
