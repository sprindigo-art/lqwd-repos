package com.lqwd.controller;

import com.lqwd.model.entities.AllTransaction;
import com.lqwd.model.entities.LspMonitorInvoice;
import com.lqwd.model.entities.LspTransaction;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.service.LNDTransactionService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class LNDTransactionController {

    private final LNDTransactionService lndTransactionService;



    @GetMapping("/v1/transactions")
    public ApiResponse<PageResponse<LspTransaction>> getTransactionsForUser(
            @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
            @RequestParam(defaultValue = "10", value= "pageSize") int pageSize,
            @RequestParam(required = false, value= "lndname") String lndname,
            OAuth2Authentication authentication) throws JSONException {



        return lndTransactionService.findUserTransaction(pageNumber, pageSize, lndname,
                authentication);

    }

    @GetMapping("/v1/payments")
    public ApiResponse<PageResponse> getUserPayments(
            @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
            @RequestParam(defaultValue = "10", value= "pageSize") int pageSize,
            @RequestParam(value= "lndname", required = false) String lndname,
            @RequestParam(required = false, value= "shouldSync") boolean shouldSync,
            OAuth2Authentication authentication) throws JSONException {


        return lndTransactionService.listLNDPayment(pageNumber, pageSize,shouldSync, lndname,
                authentication);

    }

    @GetMapping("/v1/transactions/all")
    public PageResponse<AllTransaction> getAllTransactionsForUser(
            @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
            @RequestParam(defaultValue = "10", value= "pageSize") int pageSize,
            @RequestParam(required = false, value= "nodes") String nodes,
            @RequestParam(required = false, value= "states") String states,
            @RequestParam(required = false, value= "types") String types,
            @RequestParam String startDate,
            @RequestParam String endDate,
            @RequestParam(required = false, value= "query") String query,
            OAuth2Authentication authentication) throws JSONException {



        return lndTransactionService.findAllTransactions(authentication, nodes, pageNumber,pageSize,
                states, types, startDate, endDate, query);

    }
}
