package com.lqwd.controller;

import com.lqwd.model.entities.Invoice;
import com.lqwd.model.entities.LspMonitorInvoice;
import com.lqwd.model.request.InvoiceToEmailRequest;
import com.lqwd.model.request.KeysendToEmailRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.service.InvoiceService;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import java.util.Optional;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class InvoiceController {

    private final InvoiceService invoiceService;


    @GetMapping("/v1/invoice/find_by_id")
    public ApiResponse<Invoice> getInvoiceById(@RequestParam Long invoiceId) {
        return invoiceService.findById(invoiceId);
    }

    @GetMapping("/v1/invoices")
    public ApiResponse<PageResponse<LspMonitorInvoice>> getUserInvoices(
            @RequestParam(defaultValue = "0", value = "pageNumber") int pageNumber,
            @RequestParam(defaultValue = "10", value= "pageSize") int pageSize,
            @RequestParam(required = false, value= "lndname") String lndname,
            @RequestParam(required = false, value= "state") String state,
            @RequestParam(required = false) Boolean keySend,
            OAuth2Authentication authentication) throws JSONException {

        return invoiceService.retrieveUserInvoices(pageNumber, pageSize, lndname,state,
                keySend, authentication);

    }

    @PostMapping("/v1/invoice/send_to_email")
    public ApiResponse<String> sendInvoiceToEmail(@RequestBody InvoiceToEmailRequest request,
                                                  OAuth2Authentication authentication) throws IOException {
        return invoiceService.sendInvoiceToEmail(request, authentication);
    }

    @PostMapping("/v1/invoice/send_keysend_to_email")
    public ApiResponse<String> sendKeysendDetailToEmail(@RequestBody KeysendToEmailRequest request,
                                                  OAuth2Authentication authentication) throws IOException {
        return invoiceService.sendKeySendToEmail(request, authentication);
    }



}
