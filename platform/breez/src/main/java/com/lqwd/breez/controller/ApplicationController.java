package com.lqwd.breez.controller;

import com.lqwd.breez.dto.response.InvoiceCreateResponse;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(value = "/")
@Api(value = "LSP Services", tags={"Base Endpoint"})
public class ApplicationController {


    /**
     * Gets the application status based on api-key/authorization headers.
     *
     * If all is well, returns OK in request.
     *
     * @return client status.
     */
    @ResponseBody
    @GetMapping("/status")
    @ApiOperation(value = "Gets Status of service", response = ResponseEntity.class)
    public ResponseEntity getStatus() {
        return ResponseEntity.ok("OK");
    }


}
