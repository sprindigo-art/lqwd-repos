package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.model.response.DlaResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class LiquidityService {

    private final DlaHttpClient dlaHttpClient;


    public DlaResponse getLiquidityRequests(int pageNo, int pageSize) throws Exception {

       return dlaHttpClient.getLiquidityRequests(pageNo,pageSize);


    }

    public DlaResponse openChannelForLiquidity(Long liquidityId) throws Exception {

        return dlaHttpClient.openLiquidityChannel(liquidityId);


    }

}
