package com.lqwd.controller;

import com.lqwd.model.request.AddLndPlusToNodeRequest;
import com.lqwd.model.request.CreateLndNodeRequest;
import com.lqwd.model.request.DestroyLndNodeRequest;
import com.lqwd.model.request.RestartLndRequest;
import com.lqwd.service.LNDDeploymentService;
import com.lqwd.service.LndNodeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.io.UnsupportedEncodingException;


@RestController
@RequestMapping(value = "/api")
@RequiredArgsConstructor
public class NodeController {

    private final LNDDeploymentService LNDDeploymentService;
    private final LndNodeService lndNodeService;


    @PostMapping(path = "/v1/node")
    public ResponseEntity<?> createLndNode(@RequestBody @Valid CreateLndNodeRequest request,
                                           OAuth2Authentication authentication) throws Exception {
        return ResponseEntity.ok(lndNodeService.createLndNodeV2(request, authentication));
    }

    @PostMapping(path = "/v1/node/lnd_plus")
    public ResponseEntity<?> addLndPlus(@RequestBody @Valid AddLndPlusToNodeRequest request,
                                        OAuth2Authentication authentication) {
        return ResponseEntity.ok(lndNodeService.addLndPlus(request, authentication));
    }

    @DeleteMapping(path = "/v1/node")
    public ResponseEntity<?> lndNodeDestroy(@RequestBody DestroyLndNodeRequest request,
                                            OAuth2Authentication authentication) throws UnsupportedEncodingException {
       return LNDDeploymentService.destroyNode(request, authentication);

    }

    @PostMapping(path = "/v1/node/restart")
    public ResponseEntity<?> restartLndOnlyWithoutNode(@RequestBody @Valid RestartLndRequest request,
                                                       OAuth2Authentication authentication) throws UnsupportedEncodingException {
        return ResponseEntity.ok(lndNodeService.restartLndOnlyWithoutNode(request, authentication));
    }

    @PostMapping(path = "/v1/node/restore")
    public ResponseEntity<?> restoreLndNodeFromSeed(@RequestBody @Valid CreateLndNodeRequest request,
                                                    OAuth2Authentication authentication) throws Exception {
        return ResponseEntity.ok(lndNodeService.restoreLndFromSeed(request, authentication));
    }


}
