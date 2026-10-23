package com.lqwd.controller;

import com.lqwd.model.entities.LspStaking;
import com.lqwd.model.request.StakingRenewRequest;
import com.lqwd.model.request.StakingRequest;
import com.lqwd.model.request.StakingWithdrawRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.model.response.RequestStakingResponse;
import com.lqwd.model.response.StakingListResponse;
import com.lqwd.service.StakingService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import javax.validation.constraints.Min;
import java.util.Map;
import java.util.Optional;


@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1")
public class StakingController {

    private final StakingService stakingService;


    @PostMapping("/staking/request")
    public ApiResponse<RequestStakingResponse> request(@Valid @RequestBody StakingRequest stakingRequest,
                                                       OAuth2Authentication authentication) throws Exception {

        Map<String, Object> requirements = stakingService.extractStakingRequestPrerequisites(authentication);

        RequestStakingResponse stakingResponse = stakingService.requestStaking(stakingRequest, requirements);

        return new ApiResponse<>(200, stakingResponse, "Request successful");
    }


    @GetMapping("/staking/list")
    public ApiResponse list(@Valid @Min(value = 1) @RequestParam("page") Optional<Integer> page,
                            @RequestParam("size") Optional<Integer> size,
                            @RequestParam("status") Optional<String> status,
                            @RequestParam("query") Optional<String> query,
                            OAuth2Authentication authentication) throws Exception {

        int currentPage = page.orElse(1);
        currentPage = currentPage - 1;
        int total = size.orElse(10);

        StakingListResponse response = stakingService.searchStaking(authentication,
                query.orElse(null), status.orElse(null), currentPage, total);
        return new ApiResponse<>(200, response, "Request successful");
    }

    @GetMapping("/staking/find_all")
    public PageResponse<LspStaking> list(@RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
                                         @RequestParam(defaultValue = "10", value = "pageSize") int pageSize,
                                         @RequestParam(defaultValue = "", value = "type") String type) {

        return stakingService.findAllStaking(pageNumber, pageSize, type);

    }

    @PostMapping("/staking/renew")
    public ApiResponse renewStaking(@RequestBody StakingRenewRequest stakingRenewRequest,
                                    OAuth2Authentication authentication) throws Exception {

        RequestStakingResponse stakingResponse = stakingService
                .renewStaking(stakingRenewRequest, authentication);

        if (stakingResponse != null) {
            return new ApiResponse<>(200, stakingResponse, "Request successful");
        }
        return new ApiResponse<>(400, null, "Failed to renew Staking request");
    }

    @PostMapping("/staking/withdraw")
    public ApiResponse withdrawStaking(@RequestBody StakingWithdrawRequest stakingWithdrawRequest,
                                       OAuth2Authentication authentication) {
        ApiResponse response = stakingService.withdrawStaking(stakingWithdrawRequest,
                authentication);
        return response;
    }

}
