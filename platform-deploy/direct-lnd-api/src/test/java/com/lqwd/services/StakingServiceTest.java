package com.lqwd.services;
import com.lqwd.model.entities.LspStaking.StakingType;

import com.lqwd.AbstractTest;
import com.lqwd.config.AppProperties;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.Invoice;
import com.lqwd.model.entities.LspStaking;
import com.lqwd.model.entities.LspTransaction;
import com.lqwd.model.request.StakingRequest;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.RequestStakingResponse;
import com.lqwd.repository.InvoiceRepository;
import com.lqwd.repository.LspStakingRepository;
import com.lqwd.service.StakingService;
import org.apache.http.entity.ContentType;
import org.junit.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.mock.mockito.MockBean;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.Assert.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;


public class StakingServiceTest extends AbstractTest {

    @Autowired
    private StakingService stakingService;

    @Autowired
    private AppProperties appProperties;

    @Autowired
    private InvoiceRepository invoiceRepository;

    @Autowired
    private LspStakingRepository lspStakingRepository;


    @MockBean
    LndHttpClient lndHttpClient;

    @Value("${app.staking_routing_lnd_node}")
    private String routingNode;

    @Value("${app.routing_node_namespace}")
    private String routingNodeNamespace;



    @Test
    public void requestStakingWithInvoiceSuccessTest() throws Exception {

        StakingRequest request = new StakingRequest();
        request.setDays(10);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setIpAddress("127.0.0.1");
        request.setAmount(20000);
        request.setType(LspStaking.StakingType.INVOICE);
        request.setPassphrase("Djxtian@20");

        Map<String, Object> requirements = new HashMap<>();
        requirements.put("userId", "test-id");
        requirements.put("userEmail","christian@lqwd.money");
        requirements.put("firstname", "Christian");

        Mockito.when(lndHttpClient.postRequestToLndPod(any(String.class),any(String.class),any(ContentType.class),
                        any(Optional.class),any(String.class),any(String.class)))
                .thenReturn(LNDResponse.builder().response(" {\"memo\": \"\", \"r_preimage\": \"Lc9xRDZI1flCkU5r72hfkGuzS67kA4kS18+Qcva9rtU=\"," +
                        " \"r_hash\": \"BXWNmc4BObxJ9jVioGPPluRTDsFNNLFkLwSpoPgVJVg=\", \"value\": \"20000\"," +
                        " \"value_msat\": \"20000000\", \"settled\": false, \"creation_date\": \"1647540329\"," +
                        " \"settle_date\": \"0\", \"payment_request\": \"lnbcrt200u1p3rx7rfpp5q46cmxwwqyumcj0kx432qc" +
                        "70jmj9xrkpf56tzep0qj56p7q4ykvqdqq" +
                        "cqzpgxqyz5vqsp58dystnzvv6kgsxlallp49xz25kp9ekf9kkut3cs8ulfnmgd4g2hs9qyys" +
                        "sqsjkurqqaruydyfn54tpr8nh3u4pmlkktf4q9u7cxlgytwaz6rf2" +
                        "r3w3gug8taq339dnnvw7xnf2tga7vfdqmu27yr49qddtl7slhvhsqv45vks\", \"description_hash\": \"\", " +
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

        RequestStakingResponse response = stakingService.requestStaking(request,requirements);

        assertTrue( response.getInvoicePaymentRequest().equals("lnbcrt200u1p3rx7rfpp5q46cmxwwqyumcj0kx432qc" +
                "70jmj9xrkpf56tzep0qj56p7q4ykvqdqq" +
                        "cqzpgxqyz5vqsp58dystnzvv6kgsxlallp49xz25kp9ekf9kkut3cs8ulfnmgd4g2hs9qyys" +
                        "sqsjkurqqaruydyfn54tpr8nh3u4pmlkktf4q9u7cxlgytwaz6rf2" +
                        "r3w3gug8taq339dnnvw7xnf2tga7vfdqmu27yr49qddtl7slhvhsqv45vks"));

    }

    @Test
    public void requestStakingWithBTCAddrSuccessTest() throws Exception {

        StakingRequest request = new StakingRequest();
        request.setDays(10);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setIpAddress("127.0.0.1");
        request.setAmount(20000);
        request.setType(LspStaking.StakingType.BTCADDRESS);
        request.setPassphrase("Djxtian@20");

        Map<String, Object> requirements = new HashMap<>();
        requirements.put("userId", "test-id");
        requirements.put("userEmail","christian@lqwd.money");
        requirements.put("firstname", "Christian");

        Mockito.when(lndHttpClient.getRequestToLndPod("v1/newaddress",routingNode+"."+routingNodeNamespace,
                        Optional.empty(),routingNode,appProperties.getDefault_lnd_cipher_password()))
                .thenReturn(LNDResponse.builder().response("{\"address\":\"test-lnd-address\"}")
                .status(200).build());

        RequestStakingResponse response = stakingService.requestStaking(request,requirements);

        assertTrue( response.getBtcAddress().equals("test-lnd-address"));

    }

    @Test
    public void approveStakingWithBTCSuccessTest() throws Exception {

        StakingRequest request = new StakingRequest();
        request.setDays(10);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setIpAddress("127.0.0.1");
        request.setAmount(20000);
        request.setType(LspStaking.StakingType.BTCADDRESS);
        request.setPassphrase("Djxtian@20");

        Map<String, Object> requirements = new HashMap<>();
        requirements.put("userId", "test-id");
        requirements.put("userEmail","christian@lqwd.money");
        requirements.put("firstname", "Christian");

        Mockito.when(lndHttpClient.getRequestToLndPod("v1/newaddress", routingNode+"."+routingNodeNamespace,
                        Optional.empty(),routingNode,appProperties.getDefault_lnd_cipher_password()))
                .thenReturn(LNDResponse.builder().response("{\"address\":\"test-lnd-address-2\"}")
                        .status(200).build());

        RequestStakingResponse response = stakingService.requestStaking(request,requirements);

        assertTrue( response.getBtcAddress().equals("test-lnd-address-2"));

        LspTransaction lndTransactionMessage = new LspTransaction();
        lndTransactionMessage.setAmount(20000);
        lndTransactionMessage.setNoOfConfirmations(3);
        lndTransactionMessage.setTimeStamp(Long.toString(System.currentTimeMillis()));
        lndTransactionMessage.setNodeName(routingNode);


        Boolean approveResponse = stakingService.approveStakingRequestByBtcPayment(routingNode, lndTransactionMessage,
                response.getBtcAddress());


        assertTrue( approveResponse);

    }

    @Test
    public void approveStakingWithInvoiceSuccessTest() throws Exception {

        Invoice invoice = new Invoice();
        invoice.setHashStr("BXWNmc4BObxJ9jVioGPPluRTDsFNNLFkLwSpoPgVJVg=");
        invoice.setAmt(20000);
        invoice.setPaymentRequest("lnbcrt200u1p3rx7rfpp5q46cmxwwqyumcj0kx432qc" +
                "70jmj9xrkpf56tzep0qj56p7q4ykvqdqq" +
                        "cqzpgxqyz5vqsp58dystnzvv6kgsxlallp49xz25kp9ekf9kkut3cs8ulfnmgd4g2hs9qyys" +
                        "sqsjkurqqaruydyfn54tpr8nh3u4pmlkktf4q9u7cxlgytwaz6rf2" +
                        "r3w3gug8taq339dnnvw7xnf2tga7vfdqmu27yr49qddtl7slhvhsqv45vka");
        invoice.setPaymentAddress("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        invoice.setAddIndex("0");
        invoice.setNodeName(routingNode);
        invoice.setPaid(false);
        invoice.setPaymentDate(new Date());

        invoice = invoiceRepository.save(invoice);

        LspStaking staking = new LspStaking();
        staking.setUserId("test-user");
        staking.setUserEmail("christian@lqwd.money");
        staking.setUserFirstname("Christian");
        staking.setDays(10);
        staking.setAmount(20000);
        staking.setCreated(new Date());
        staking.setStatus("OPEN");
        staking.setStakingType(StakingType.INVOICE);
        staking.setStakingReference(invoice.getId());
        staking.setNodeName(routingNode);
        staking.setPaymentDate(new Date());

        lspStakingRepository.save(staking);


        StakingRequest request = new StakingRequest();
        request.setDays(10);
        request.setPubKey("02509b6904091bed92849fd3f861d7ac478ac099760a9779587596a2cc49fb0ecf");
        request.setIpAddress("127.0.0.1");
        request.setAmount(20000);
        request.setType(LspStaking.StakingType.BTCADDRESS);
        request.setPassphrase("Djxtian@20");

        Map<String, Object> requirements = new HashMap<>();
        requirements.put("userId", "test-id");
        requirements.put("userEmail","christian@lqwd.money");
        requirements.put("firstname", "Christian");

        Mockito.when(lndHttpClient.getRequestToLndPod("v1/newaddress",routingNode+"."+routingNodeNamespace,
                        Optional.empty(),routingNode,appProperties.getDefault_lnd_cipher_password()))
                .thenReturn(LNDResponse.builder().response("{\"address\":\"test-lnd-address-3\"}")
                        .status(200).build());

        Boolean response = stakingService.approveStakingRequestByInvoice("lnbcrt200u1p3rx7rfpp5q46cmxwwqyumcj0kx432qc" +
                "70jmj9xrkpf56tzep0qj56p7q4ykvqdqq" +
                        "cqzpgxqyz5vqsp58dystnzvv6kgsxlallp49xz25kp9ekf9kkut3cs8ulfnmgd4g2hs9qyys" +
                        "sqsjkurqqaruydyfn54tpr8nh3u4pmlkktf4q9u7cxlgytwaz6rf2" +
                        "r3w3gug8taq339dnnvw7xnf2tga7vfdqmu27yr49qddtl7slhvhsqv45vka","SETTLED");

        assertTrue( response);

    }
}