package com.lqwd.service;

import com.lqwd.config.AppProperties;
import com.lqwd.httpclient.BitcoinRPCClient;
import com.lqwd.model.BTCResponse;
import com.lqwd.model.entities.BtcTransactionHash;
import com.lqwd.model.enums.LndNetwork;
import com.lqwd.repository.BtcTransactionHashRepository;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class BtcTransactionHashService {

    private final static Logger logger = LoggerFactory.getLogger(BtcTransactionHashService.class);

    private final BtcTransactionHashRepository btcTransactionHashRepository;
    private final LiquidityService liquidityService;
    private final StakingService stakingService;
    private final AppProperties properties;

    private final BitcoinRPCClient regTestClient;
    private final BitcoinRPCClient testNetClient;
    private final BitcoinRPCClient mainNetClient;


    public void checkNoOfConfirmationOnBTCD() {

        Iterable<BtcTransactionHash> hashes = btcTransactionHashRepository.findAll();
        List<BtcTransactionHash> hashesToDelete = new ArrayList<>();

        regTestClient.initializeHttpClient();
        testNetClient.initializeHttpClient();
        mainNetClient.initializeHttpClient();

        for (BtcTransactionHash hash : hashes) {

            BitcoinRPCClient client = getClientByNetwork(hash.getLndNetwork());

            BTCResponse response = client.getTransaction(hash.getTrxHash());

            if(response.getStatus() != 200)
                continue;


            JSONObject jsonObject = new JSONObject(response.getResponse());

            int confirmations = jsonObject.getJSONObject("result").getInt("confirmations");

            if(confirmations < properties.getMin_confirmation_liquidity_and_staking())
                continue;

            //do liquidity and staking check
            try {
                liquidityService.approveLiquidityByBTCAddressRequest(hash);
            } catch (Exception e) {
                logger.info("An error occurred in approve liquidity: {}", e.getMessage());
            }

            stakingService.approveStakingRequestByBtcPayment(hash);

            hashesToDelete.add(hash);

        }

        btcTransactionHashRepository.deleteAll(hashesToDelete);
        regTestClient.close();
        testNetClient.close();
        mainNetClient.close();

    }

    private BitcoinRPCClient getClientByNetwork(LndNetwork network) {

        if (network.equals(LndNetwork.REGTEST))
            return regTestClient;
        if (network.equals(LndNetwork.TESTNET))
            return testNetClient;

        return mainNetClient;
    }


}
