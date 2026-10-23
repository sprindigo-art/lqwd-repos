package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.model.response.DlaResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class StakingService {

    private final DlaHttpClient dlaHttpClient;


    public DlaResponse getStakingList(int pageNo, int pageSize) throws Exception {

       return dlaHttpClient.getStakingList(pageNo,pageSize);


    }


}
