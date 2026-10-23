package com.lqwd.billing.controllers;

import com.lqwd.billing.entities.Invoice;
import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.PageResponse;
import com.lqwd.billing.services.InvoiceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api")
@RequiredArgsConstructor
public class InvoiceController {


    private final InvoiceService invoiceService;

    @GetMapping(path = "/v1/invoices")
    public ResponseEntity<ApiResponse> getMyInvoices(@RequestHeader(HttpHeaders.AUTHORIZATION) String token,
    @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
    @RequestParam(defaultValue = "10", value= "pageSize") int pageSize ) throws Exception {

        PageResponse<Invoice> res  = invoiceService.getMyInvoices(pageNumber, pageSize, token);

        return ResponseEntity.ok(new ApiResponse(res, true,
                "Invoices retrieved successfully"));

    }






}
