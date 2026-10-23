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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.io.UnsupportedEncodingException;


@RestController
@RequestMapping(value = "/kubernetes")
@RequiredArgsConstructor
public class KubernetesController {

    private final LNDDeploymentService LNDDeploymentService;
    private final LndNodeService lndNodeService;


    @PostMapping(path = "/lnd_node/create")
    public ResponseEntity<?> createLndNode(@RequestBody @Valid CreateLndNodeRequest request,
                                           OAuth2Authentication authentication) throws UnsupportedEncodingException {
        return ResponseEntity.ok(lndNodeService.createLndNode(request, authentication));
    }

    @PostMapping(path = "/lnd_node/addlndplus")
    public ResponseEntity<?> addLndPlus(@RequestBody @Valid AddLndPlusToNodeRequest request,
                                        OAuth2Authentication authentication) {
        return ResponseEntity.ok(lndNodeService.addLndPlus(request, authentication));
    }

    @PostMapping(path = "/lndnode/destroy")
    public ResponseEntity<?> lndNodeDestroy(@RequestBody DestroyLndNodeRequest request,
                                            OAuth2Authentication authentication) throws UnsupportedEncodingException {
       return LNDDeploymentService.destroyNode(request, authentication);

    }

    @PostMapping(path = "/lnd_node/restart_lnd")
    public ResponseEntity<?> restartLndOnlyWithoutNode(@RequestBody @Valid RestartLndRequest request,
                                                       OAuth2Authentication authentication) throws UnsupportedEncodingException {
        return ResponseEntity.ok(lndNodeService.restartLndOnlyWithoutNode(request, authentication));
    }

    @PostMapping(path = "/lnd_node/restore")
    public ResponseEntity<?> restoreLndNodeFromSeed(@RequestBody @Valid CreateLndNodeRequest request,
                                                    OAuth2Authentication authentication) throws Exception {
        return ResponseEntity.ok(lndNodeService.restoreLndFromSeed(request, authentication));
    }


}
