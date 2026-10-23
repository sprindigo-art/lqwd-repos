package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.model.entities.LndNodeBalance;
import com.lqwd.model.entities.LndNodeDetail;
import com.lqwd.service.LndNodeBalanceService;
import com.lqwd.service.LndNodeInfoService;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.junit.Assert.assertEquals;


public class LndNodeDetailServiceTest extends AbstractTest {

    @Autowired
    private LndNodeInfoService lndNodeInfoService;

    @Autowired
    private LndNodeBalanceService lndNodeBalanceService;



    @Test
    public void createNodeInfoTest() throws JSONException {

        String json = "{\n" +
                "\"version\": \"0.14.2-beta commit=v0.14.2-beta\",\n" +
                "\"commit_hash\": \"1e511be523eb8e97c4e2d9c89a7a263963a3929f\",\n" +
                "\"identity_pubkey\": \"025b4396e975b90c899eac2ac30bec386d69eac90d5a8559b73097b7aceb0eb70e\",\n" +
                "\"alias\": \"aziz77\",\n" +
                "\"color\": \"#3399ff\",\n" +
                "\"num_pending_channels\": 0,\n" +
                "\"num_active_channels\": 4,\n" +
                "\"num_inactive_channels\": 0,\n" +
                "\"num_peers\": 5,\n" +
                " \"block_height\": 2287137,\n" +
                " \"block_hash\": \"00000000000000125eace13005a0dc81270a5f3397aa8286ad65824682488fd2\",\n" +
                " \"best_header_timestamp\": \"1658424075\",\n" +
                " \"synced_to_chain\": true,\n" +
                " \"synced_to_graph\": true,\n" +
                " \"testnet\": true,\n" +
                " \"chains\": [\n" +
                "   {\n" +
                "     \"chain\": \"bitcoin\",\n" +
                "     \"network\": \"testnet\"\n" +
                "   }\n" +
                " ],\n" +
                " \"uris\": [\n" +
                "   \"025b4396e975b90c899eac2ac30bec386d69eac90d5a8559b73097b7aceb0eb70e@52.42.242.180:32502\"\n" +
                " ],\n" +
                " \"features\": {\n" +
                "   \"0\": {\n" +
                "     \"name\": \"data-loss-protect\",\n" +
                "     \"is_required\": true,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"5\": {\n" +
                "     \"name\": \"upfront-shutdown-script\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"7\": {\n" +
                "     \"name\": \"gossip-queries\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"9\": {\n" +
                "     \"name\": \"tlv-onion\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"12\": {\n" +
                "     \"name\": \"static-remote-key\",\n" +
                "     \"is_required\": true,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"14\": {\n" +
                "     \"name\": \"payment-addr\",\n" +
                "     \"is_required\": true,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"17\": {\n" +
                "     \"name\": \"multi-path-payments\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"23\": {\n" +
                "     \"name\": \"anchors-zero-fee-htlc-tx\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"30\": {\n" +
                "     \"name\": \"amp\",\n" +
                "     \"is_required\": true,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"31\": {\n" +
                "     \"name\": \"amp\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"45\": {\n" +
                "     \"name\": \"explicit-commitment-type\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   },\n" +
                "   \"2023\": {\n" +
                "     \"name\": \"script-enforced-lease\",\n" +
                "     \"is_required\": false,\n" +
                "     \"is_known\": true\n" +
                "   }\n" +
                " }\n" +
                "}";

        LndNodeDetail info = lndNodeInfoService.createInfoFromMonitoring(new JSONObject(json), "node-1", "user-4");

        assertEquals("bitcoin-testnet",info.getChains());
        assertEquals("node-1",info.getNodeName());
        assertEquals(true,info.isSynced_to_chain());

    }

    @Test
    public void createNodeBalance() throws Exception {

        String json = "{\n" +
                "\"total_balance\": \"316240\",\n" +
                "\"confirmed_balance\": \"316240\",\n" +
                "\"unconfirmed_balance\": \"0\",\n" +
                "\"account_balance\": {\n" +
                "\"default\": {\n" +
                "\"confirmed_balance\": \"316240\",\n" +
                "\"unconfirmed_balance\": \"0\"\n" +
                "}\n" +
                "}\n" +
                "}";

        LndNodeBalance balance = lndNodeBalanceService.createBalanceFromMonitoring(new JSONObject(json), "node-1", "user-4");

        assertEquals("316240",balance.getConfirmed_balance());
        assertEquals("0",balance.getUnconfirmed_balance());

    }


}