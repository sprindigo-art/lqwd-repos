package com.lqwd.breez.controller;

import com.lqwd.breez.dto.request.InvoiceCreateRequest;
import com.lqwd.breez.dto.response.InvoiceCreateResponse;
import com.lqwd.breez.service.LndService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Api(value = "LSP Lnd Services", tags={"Lnd Actions Endpoint"})
@RestController
@RequestMapping(value = "/lnd")
public class LndController {

    @Autowired
    LndService lndService;

    @ResponseBody
    @PostMapping("/createinvoice")
    @ApiOperation(value = "Create Invoice On Lnd Node", response = InvoiceCreateResponse.class)
    public ResponseEntity<InvoiceCreateResponse> create(@RequestBody InvoiceCreateRequest invoiceCreateRequest) {
        InvoiceCreateResponse response = lndService.createInvoice(invoiceCreateRequest);
        return ResponseEntity.ok(response);
    }


}
