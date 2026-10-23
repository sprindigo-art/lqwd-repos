package com.lqwd.config;

import com.lqwd.httpclient.BitcoinRPCClient;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class BTCDClientsConfig {


    private final AppProperties properties;

    @Bean
    public BitcoinRPCClient regTestClient() {

        AppProperties.Credential credential = properties.getBtcd().get("regtest");

        return new BitcoinRPCClient(credential.getHost(),
                credential.getPort(),
                credential.getUsername(),credential.getPassword());

    }

    @Bean
    public BitcoinRPCClient testNetClient() {

        AppProperties.Credential credential = properties.getBtcd().get("testnet");

        return new BitcoinRPCClient(credential.getHost(),
                credential.getPort(),
                credential.getUsername(),credential.getPassword());

    }

    @Bean
    public BitcoinRPCClient mainNetClient(){

        AppProperties.Credential credential = properties.getBtcd().get("mainnet");

        return new BitcoinRPCClient(credential.getHost(),
                credential.getPort(),
                credential.getUsername(),credential.getPassword());

    }


}
