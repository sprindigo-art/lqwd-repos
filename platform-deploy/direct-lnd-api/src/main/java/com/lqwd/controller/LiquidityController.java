package com.lqwd.controller;

import com.lqwd.model.entities.BtcPaymentAddress;
import com.lqwd.model.entities.Invoice;
import com.lqwd.model.entities.Liquidity;
import com.lqwd.model.request.RequestLiquidityRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.model.response.RequestLiquidityResponse;
import com.lqwd.service.LiquidityService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;


import javax.validation.Valid;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class LiquidityController {

    private final LiquidityService liquidityService;

    @PostMapping("/v1/liquidity")
    public ApiResponse<RequestLiquidityResponse> requestLiquidity(@RequestBody @Valid RequestLiquidityRequest request,
                                                                  OAuth2Authentication authentication) throws Exception {
        if(authentication == null)
            return liquidityService.requestLiquidity(request);

        return liquidityService.requestLiquidity(request,authentication);
    }

    @PostMapping("/v1/liquidity/create_channel")
    public ApiResponse<Liquidity> finalizeLiquidity(@RequestParam long liquidityId) throws Exception {

        return liquidityService.handleFailedLiquidityChannelCreation(liquidityId);
    }

    @GetMapping("/v1/liquidity/invoices")
    public PageResponse<Invoice> loadInvoices(OAuth2Authentication authentication,
                                              @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
                                              @RequestParam(defaultValue = "10", value= "pageSize") int pageSize) throws JSONException {
        return liquidityService.loadLiquidity(authentication, pageNumber,pageSize);
    }
    @GetMapping("/v1/liquidity/btc")
    public PageResponse<BtcPaymentAddress> loadBtcAddresses(OAuth2Authentication authentication,
                                                            @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
                                                            @RequestParam(defaultValue = "10", value= "pageSize") int pageSize) throws JSONException {
        return liquidityService.loadLiquidityBtc(authentication, pageNumber,pageSize);
    }
    @GetMapping("/v1/liquidity/find_all")
    public PageResponse<Liquidity> listLiquidityRequests
            (@RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
             @RequestParam(defaultValue = "10", value= "pageSize") int pageSize) {

        return liquidityService.getLiquidityRequests(pageNumber,pageSize);
    }
    @GetMapping("/v1/liquidity")
    public ApiResponse liquidityByUser
            (@RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
             @RequestParam(defaultValue = "10", value= "pageSize") int pageSize,
             @RequestParam(defaultValue = "", value= "type") String type,
             OAuth2Authentication authentication) {
        PageResponse<Liquidity> pageResponse = liquidityService.getLiquidityRequests(pageNumber,pageSize,
                type, authentication);
        return new ApiResponse<>(200, pageResponse, "Request successful");
    }
}
