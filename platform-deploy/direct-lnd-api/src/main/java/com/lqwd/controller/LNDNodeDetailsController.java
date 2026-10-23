package com.lqwd.controller;

import com.lqwd.model.entities.LndNodeBalance;
import com.lqwd.model.entities.LndNodeDetail;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.NodeInfoResponse;
import com.lqwd.repository.LndNodeInfoRepository;
import com.lqwd.service.LndNodeBalanceService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class LNDNodeDetailsController {

    private final LndNodeBalanceService lndNodeBalanceService;
    private final LndNodeInfoRepository lndNodeInfoRepository;


    @GetMapping("/v1/lnd_details/node_balances")
    public ApiResponse<Map<String, Long>> getNodeBalances(
            @RequestParam String startDate,
            @RequestParam String endDate,
            OAuth2Authentication authentication) throws JSONException {

        return lndNodeBalanceService.getUserTotalNodeBalanceHistory(startDate, endDate, authentication);

    }

    @GetMapping("/v1/lnd_details/total_node_balance")
    public ApiResponse<Long> getTotalNodeBalancesForUser(
            OAuth2Authentication authentication) throws JSONException {

        return lndNodeBalanceService.getTotalNodeBalancesForUser(authentication);

    }



    @GetMapping("/v1/lnd_details/node_info")
    public ApiResponse<NodeInfoResponse> get_node_info(
            @RequestParam String lndname) throws JSONException {

        LndNodeBalance balance = lndNodeBalanceService.getNodeLatestBalance(lndname);

        LndNodeDetail info = lndNodeInfoRepository.findByNodeName(lndname).orElse(null);

        NodeInfoResponse nodeInfoResponse = new NodeInfoResponse();
        nodeInfoResponse.setBalance(balance);
        nodeInfoResponse.setInfo(info);


        return new ApiResponse<>(nodeInfoResponse, "success");

    }

}
