package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.Liquidity;
import com.lqwd.model.entities.LndChannel;
import com.lqwd.model.enums.LiquidityType;
import com.lqwd.model.request.RequestLiquidityRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.RequestLiquidityResponse;
import com.lqwd.repository.LiquidityRepository;
import com.lqwd.repository.LndChannelRepository;
import com.lqwd.service.LiquidityService;
import org.apache.http.entity.ContentType;
import org.junit.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.mock.mockito.MockBean;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.Assert.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;


public class LiquidityServiceTest extends AbstractTest {

    @Autowired
    private LiquidityService liquidityService;

    @Autowired
    private LndChannelRepository lndChannelRepository;

    @Autowired
    private LiquidityRepository liquidityRepository;

    @MockBean
    LndHttpClient lndHttpClient;

    @Value("${app.routing_node_name}")
    private String routingNode;

    @Value("${app.routing_node_namespace}")
    private String routingNodeNamespace;

    @Autowired
    private AppProperties appProperties;


    @Test
    public void liquidityRequestWrongDurationFailedTest() {

        RequestLiquidityRequest request = new RequestLiquidityRequest();
        request.setNumberOfWeeks(3);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setNodeAddress("127.0.0.1");
        request.setAmount(20000);
        request.setRefNo("ref-12-22");

        BadRequestException exception = assertThrows(BadRequestException.class, () ->
                liquidityService.makeLiquidityRequest(request,"testpass"));


        String expectedMessage = "Number of weeks should be in multiples of two";
        String actualMessage = exception.getMessage();

        assertTrue(actualMessage.contains(expectedMessage));
        assertTrue(400 == exception.getStatus());

    }

    @Test
    public void liquidityRequestByInvoiceSuccessfulTest() throws Exception {

        RequestLiquidityRequest request = new RequestLiquidityRequest();
        request.setNumberOfWeeks(4);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setNodeAddress("127.0.0.1");
        request.setUserEmail("christian@lqwd.money");
        request.setType(LiquidityType.INVOICE);
        request.setAmount(20000);
        request.setRefNo("ref-12-22");


        Mockito.when(lndHttpClient.postRequestToLndPod(any(String.class),any(String.class),any(ContentType.class),
                        any(Optional.class),any(String.class),any(String.class)))
                .thenReturn(LNDResponse.builder().response(" {\"memo\": \"\", \"r_preimage\": \"Lc9xRDZI1flCkU5r72hfkGuzS67kA4kS18+Qcva9rtU=\"," +
                        " \"r_hash\": \"BXWNmc4BObxJ9jVioGPPluRTDsFNNLFkLwSpoPgVJZg=\", \"value\": \"20000\"," +
                        " \"value_msat\": \"20000000\", \"settled\": false, \"creation_date\": \"1647540329\"," +
                        " \"settle_date\": \"0\", \"payment_request\": \"lnbcrt200u1p3rx7rfpp5q46cmxwwqyumcj0kx432qc" +
                        "70jmj9xrkpf56tzep0qj56p7q4ykvqdqq" +
                        "cqzpgxqyz5vqsp58dystnzvv6kgsxlallp49xz25kp9ekf9kkut3cs8ulfnmgd4g2hs9qyys" +
                        "sqsjkurqqaruydyfn54tpr8nh3u4pmlkktf4q9u7cxlgytwaz6rf2" +
                        "r3w3gug8taq339dnnvw7xnf2tga7vfdqmu27yr49qddtl7slhvhsqv45vka\", \"description_hash\": \"\", " +
                        "\"expiry\": \"86400\"," +
                        " \"fallback_addr\": \"\", \"cltv_expiry\": \"40\", \"route_hints\": [], \"private\": false," +
                        " \"add_index\": \"17\", " +
                        "\"settle_index\": \"0\", \"amt_paid\": \"0\", \"amt_paid_sat\": \"0\", \"amt_paid_msat\": \"0\"," +
                        " \"state\": \"OPEN\", \"htlcs\": [], \"features\": {\"9\": {\"name\": \"tlv-onion\"," +
                        " \"is_required\": false, \"is_known\": true}, \"14\": {\"name\": \"payment-addr\", \"is_required\": true, " +
                        "\"is_known\": true}, \"17\": {\"name\": \"multi-path-payments\", " +
                        "\"is_required\": false, \"is_known\": true}}, \"is_keysend\": false, " +
                        "\"payment_addr\": \"O0kFzExmrIgb/f/DUphKpYJc2SW1uLjiB+fTPaG1Qq8=\"," +
                        " \"is_amp\": false, \"amp_invoice_state\": {}}").status(200).build());

        Mockito.when(lndHttpClient.getRequestToLndPod(any(String.class),any(String.class),any(Optional.class),
               any(String.class),any(String.class))).thenReturn(LNDResponse.builder().response(
                        "{\"peers\":[" +
                        "{\"pub_key\": \"02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf\"}" +
                        "]}")
                .status(200).build());

        Map<String, Object> params = new HashMap<>();
        params.put("target_conf", 6);
        params.put(String.format("AddrToAmount[%s]","02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf"), 20000);

        Mockito.when(lndHttpClient.getRequestToLndPod("v1/transactions/fee",routingNode+"."+routingNodeNamespace,
                Optional.of(params), routingNode,appProperties.getDefault_lnd_cipher_password())).thenReturn(LNDResponse.builder().response(
                        "{\"fee_sat\": 200}")
                .status(200).build());

        ApiResponse<RequestLiquidityResponse> response =  liquidityService.makeLiquidityRequest(request,"test-user-1");


        assertTrue(200 == response.getStatus());

        //fee = (no of weeks / 2 * 0.5) / 100 * sat
        assertTrue(200 == response.getData().getLiquidity().getFeeToPay());

        assertTrue(4 == response.getData().getLiquidity().getDurationInWeeks());


    }

    @Test
    public void liquidityRequestByBTCAddressSuccessfulTest() throws Exception {

        RequestLiquidityRequest request = new RequestLiquidityRequest();
        request.setNumberOfWeeks(4);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setNodeAddress("127.0.0.1");
        request.setUserEmail("christian@lqwd.money");
        request.setType(LiquidityType.BTC_ADDRESS);
        request.setAmount(20000);
        request.setRefNo("ref-12-23");


        Mockito.when(lndHttpClient.getRequestToLndPod("v1/newaddress", routingNode+"."+routingNodeNamespace,
                        Optional.empty(),routingNode,appProperties.getDefault_lnd_cipher_password()))
                .thenReturn(LNDResponse.builder().response("{\"address\":\"test-lnd-address-liquidity\"}")
                        .status(200).build());


        Mockito.when(lndHttpClient.getRequestToLndPod("v1/peers",routingNode+"."+routingNodeNamespace,
                Optional.empty(), routingNode,appProperties.getDefault_lnd_cipher_password())).thenReturn(LNDResponse.builder().response(
                        "{\"peers\":[" +
                                "{\"pub_key\": \"02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf\"}" +
                                "]}")
                .status(200).build());

        Map<String, Object> params = new HashMap<>();
        params.put("target_conf", 6);
        params.put(String.format("AddrToAmount[%s]","02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf"), 20000);

        Mockito.when(lndHttpClient.getRequestToLndPod("v1/transactions/fee",routingNode+"."+routingNodeNamespace,
                Optional.of(params), routingNode,appProperties.getDefault_lnd_cipher_password())).thenReturn(LNDResponse.builder().response(
                        "{\"fee_sat\": 200}")
                .status(200).build());


        ApiResponse<RequestLiquidityResponse> response =  liquidityService
                .makeLiquidityRequest(request,"test-user-1");


        assertTrue(200 == response.getStatus());

        assertTrue(response.getData().getPaymentRequest().equals("test-lnd-address-liquidity"));

        //fee = (no of weeks / 2 * 0.5) / 100 * sat
        assertTrue(200 == response.getData().getLiquidity().getFeeToPay());

        assertTrue(4 == response.getData().getLiquidity().getDurationInWeeks());


    }

    @Test
    public void approveLiquiditySuccessfulTest() throws Exception {

        RequestLiquidityRequest request = new RequestLiquidityRequest();
        request.setNumberOfWeeks(4);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setNodeAddress("127.0.0.1");
        request.setUserEmail("christian@lqwd.money");
        request.setAmount(20000);
        request.setType(LiquidityType.INVOICE);
        request.setRefNo("ref-12-22");


        Mockito.when(lndHttpClient.postRequestToLndPod(any(String.class),any(String.class),any(ContentType.class),
                        any(Optional.class),any(String.class),any(String.class)))
                .thenReturn(LNDResponse.builder().response(" {\"memo\": \"\", \"r_preimage\": \"Lc9xRDZI1flCkU5r72hfkGuzS67kA4kS18+Qcva9rtU=\"," +
                        " \"r_hash\": \"BXWNmc4BObxJ9jVioGPPluRTDsFNNLFkLwSpoPgVJZu=\", \"value\": \"20000\"," +
                        " \"value_msat\": \"20000000\", \"settled\": false, \"creation_date\": \"1647540329\"," +
                        " \"settle_date\": \"0\", \"payment_request\": \"lnbcrt200u1p3rx7rfpp5q46cmxwwqyumcj0kx432qc" +
                        "70jmj9xrkpf56tzep0qj56p7q4ykvqdqq" +
                        "cqzpgxqyz5vqsp58dystnzvv6kgsxlallp49xz25kp9ekf9kkut3cs8ulfnmgd4g2hs9qyys" +
                        "sqsjkurqqaruydyfn54tpr8nh3u4pmlkktf4q9u7cxlgytwaz6rf2" +
                        "r3w3gug8taq339dnnvw7xnf2tga7vfdqmu27yr49qddtl7slhvhsqv45vka\", \"description_hash\": \"\", " +
                        "\"expiry\": \"86400\"," +
                        " \"fallback_addr\": \"\", \"cltv_expiry\": \"40\", \"route_hints\": [], \"private\": false," +
                        " \"add_index\": \"17\", " +
                        "\"settle_index\": \"0\", \"amt_paid\": \"0\", \"amt_paid_sat\": \"0\", \"amt_paid_msat\": \"0\"," +
                        " \"state\": \"OPEN\", \"htlcs\": [], \"features\": {\"9\": {\"name\": \"tlv-onion\"," +
                        " \"is_required\": false, \"is_known\": true}, \"14\": {\"name\": \"payment-addr\", \"is_required\": true, " +
                        "\"is_known\": true}, \"17\": {\"name\": \"multi-path-payments\", " +
                        "\"is_required\": false, \"is_known\": true}}, \"is_keysend\": false, " +
                        "\"payment_addr\": \"O0kFzExmrIgb/f/DUphKpYJc2SW1uLjiB+fTPaG1Qq8=\"," +
                        " \"is_amp\": false, \"amp_invoice_state\": {}}").status(200).build());

        Mockito.when(lndHttpClient.postRequestToLndPod(any(String.class),any(String.class),any(ContentType.class),
                any(Optional.class),any(String.class),isNull())).thenReturn(LNDResponse.builder().response("{}")
                .status(200).build());

        Map<String, Object> params = new HashMap<>();
        params.put("target_conf", 6);
        params.put(String.format("AddrToAmount[%s]","02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf"), 20000);

        Mockito.when(lndHttpClient.getRequestToLndPod("v1/transactions/fee",routingNode+"."+routingNodeNamespace,
                Optional.of(params), routingNode,appProperties.getDefault_lnd_cipher_password())).thenReturn(LNDResponse.builder().response(
                        "{\"fee_sat\": 200}")
                .status(200).build());

        ApiResponse<RequestLiquidityResponse> response =  liquidityService.makeLiquidityRequest(request,"test-user-1");


        assertTrue(200 == response.getStatus());

        Mockito.when(lndHttpClient.postRequestToLndPod(any(String.class),any(String.class),any(ContentType.class),
                any(Optional.class),any(String.class),any(String.class))).thenReturn(
                        LNDResponse.builder().response("{\"funding_txid_bytes\":\"test\"," +
                "\"funding_txid_str\":\"test\",\"output_index\":1}").status(200).build());

        liquidityService.approveLiquidityByInvoiceRequest
                ("BXWNmc4BObxJ9jVioGPPluRTDsFNNLFkLwSpoPgVJZu=", true, "0");

        //fee = (no of weeks / 2 * 0.5) / 100 * sat
        assertTrue(200 == response.getData().getLiquidity().getFeeToPay());

        assertTrue(4 == response.getData().getLiquidity().getDurationInWeeks());


    }

    @Test
    public void channelOpenTest() throws Exception {


        Mockito.when(lndHttpClient.postRequestToLndPod(any(String.class),any(String.class),any(ContentType.class),
                any(Optional.class),any(String.class),any(String.class)))
                .thenReturn(LNDResponse.builder().response("{\"funding_txid_bytes\":\"test\"," +
                "\"funding_txid_str\":\"test\",\"output_index\":1}").status(200).build());

        Liquidity liquidity = new Liquidity();
        liquidity.setPubkey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        liquidity.setAmt(20000);
        liquidity.setPaymentOptionId(1l);
        liquidity.setType(LiquidityType.INVOICE);
        liquidity.setIpAddress("127.0.0.1");
        liquidity.setUserId("1111-11111-1111");
        liquidity.setEstimatedChannelFee(200);
        liquidity.setDurationInWeeks(20);

        LndChannel res = liquidityService.openChannelToUserNode(liquidity,"testpass");


        assertEquals(true,res != null);

    }

    @Test
    public void channelCloseTest() throws Exception {


        LndChannel channel = new LndChannel();
        channel.setFundingTxIdBase64("test");
        channel.setOutputIndex(1);
        channel.setOpen(true);
        channel.setChannelExpiryDate(new Date());

        channel = lndChannelRepository.save(channel);



        Liquidity liquidity = new Liquidity();
        liquidity.setAmt(20000);
        liquidity.setFee(200);
        liquidity.setUserId("test-uuid");
        liquidity.setUserEmail("christian@lqwd.money");
        liquidity.setPaymentOptionId(1l);
        liquidity.setChannelId(channel.getId());
        liquidity.setPaid(false);
        liquidity.setPubkey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        liquidity.setIpAddress("slnd-1222.lqwd-lnd");
        liquidity.setDurationInWeeks(4);
        liquidity.setChannelExpiryDate(new Date());
        liquidity.setExpired(false);

        liquidityRepository.save(liquidity);


        Mockito.when(lndHttpClient.deleteRequestToLndPod(any(String.class), any(String.class), any(Optional.class),
                any(String.class), any(String.class))).thenReturn(LNDResponse.builder().response("{\"chan_close\":\"test\"," +
                "\"funding_txid_str\":\"test\",\"output_index\":1}").status(200).build());

        List<LndChannel> closedChanList = liquidityService.handleCloseLiquidity();


        assertEquals(1,closedChanList.size());

    }

    @Test
    public void peerNodesTest() throws Exception {

        Liquidity liquidity = new Liquidity();
        liquidity.setPubkey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        liquidity.setAmt(20000);
        liquidity.setIpAddress("127.0.0.1");
        liquidity.setDurationInWeeks(20);


        Mockito.when(lndHttpClient.postRequestToLndPod(any(String.class),any(String.class),any(ContentType.class),
                any(Optional.class),any(String.class),isNull()))
                .thenReturn(LNDResponse.builder().response("{}").status(200).build());


//        boolean res = liquidityService.(liquidity.getPubkey(),liquidity.getIpAddress());

//        assertEquals(true,res);

    }




}