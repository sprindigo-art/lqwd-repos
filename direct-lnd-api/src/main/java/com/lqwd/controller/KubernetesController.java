package com.lqwd.controller;

import com.lqwd.model.User;

import com.lqwd.service.KubernetesService;

import org.json.JSONException;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.io.IOException;


@RestController
@RequestMapping(value = "/kubernetes")
public class KubernetesController {

    @Autowired
    KubernetesService kubernetesService;




    @ResponseBody
    @PostMapping(path = "/lndnode/watchtower/create")
    public ResponseEntity<?> lndNodeWachtowerCreate(@Valid User user, @RequestParam String lnd_network, BindingResult bindingResult) throws Exception {



          return kubernetesService.lndCreate(user,  lnd_network, bindingResult, true);
    }

    @ResponseBody
    @PostMapping(path = "/lndnode/create")
    public ResponseEntity<?> lndNodeCreate(@Valid User user, @RequestParam String lnd_network, BindingResult bindingResult) throws Exception {

       return kubernetesService.lndCreate(user, lnd_network, bindingResult, false);
    }

    @ResponseBody
    @PostMapping(path = "/lndnode/destroy")
    public ResponseEntity<?> lndNodeDestroy(@Valid User user, @RequestParam String lndnodename,  BindingResult bindingResult) throws IOException, JSONException {

       return kubernetesService.ldnDestroy(user, lndnodename, bindingResult);

    }
}
