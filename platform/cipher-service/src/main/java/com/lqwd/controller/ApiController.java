package com.lqwd.controller;

import com.lqwd.model.request.*;
import com.lqwd.model.response.*;
import com.lqwd.service.CipherService;
import com.lqwd.service.OauthService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.util.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1")
public class ApiController {

    @Autowired
    CipherService cipherService;

    @Autowired
    OauthService oauthService;

    @PostMapping("/savefile")
    public ResponseEntity saveFile(@Valid @RequestBody SaveLndFileRequest cipherRequest){
        cipherService.saveLndFile(cipherRequest);
        return ResponseEntity.ok("OK");
    }

    @PostMapping("/setpassword")
    public ResponseEntity setPassword(@Valid @RequestBody SetPasswordRequest cipherRequest){
        cipherService.setPassword(cipherRequest);
        return ResponseEntity.ok("OK");
    }

    @PostMapping("/shareduser")
    public ResponseEntity sharedUser(@Valid @RequestBody SetSharedUserRequest cipherRequest){
        cipherService.sharedUserCreate(cipherRequest);
        return ResponseEntity.ok("OK");
    }


    @PostMapping("/encrypt")
    public ResponseEntity encrypt(@Valid @RequestBody EncryptRequest cipherRequest){
        return ResponseEntity.ok(cipherService.encrypt(cipherRequest));
    }

    @PostMapping("/decrypt")
    public ResponseEntity decrypt(@Valid @RequestBody DecryptRequest cipherRequest){
        return ResponseEntity.ok(cipherService.decrypt(cipherRequest));
    }

    @PostMapping("/login")
    public ResponseEntity login(@RequestParam("username") String username, @RequestParam("password") String password){
        TokenResponse response = oauthService.login(username, password);
        return ResponseEntity.ok(response);
    }

    //All admin relates API calls
    @PostMapping("/admin/generateKey")
    public ResponseEntity generateKeyForMethod(@Valid @RequestBody GenerateKeyCipherRequest configureCipherRequest){
        String secretKey = cipherService.generateKey(configureCipherRequest);
        GenerateKeyResponse response = GenerateKeyResponse.builder()
                .secretKey(secretKey)
                .build();
        return ResponseEntity.ok(response);
    }


    @PostMapping("/admin/configure")
    public ResponseEntity configureCipherMethod(@Valid @RequestBody ConfigureCipherRequest configureCipherRequest){
        cipherService.configure(configureCipherRequest, oauthService.getUserId());
        return ResponseEntity.ok(new SuccessResponse());
    }

    @PostMapping("/admin/testencrypt")
    public ResponseEntity testEncrypt(@Valid @RequestBody TextCipherRequest textCipherRequest){
        EncryptDecryptResponse data = cipherService.testEncryption(textCipherRequest);
        return ResponseEntity.ok(data);
    }

    @PostMapping("/admin/testdecrypt")
    public ResponseEntity testDecrypt(@Valid @RequestBody TextCipherRequest textCipherRequest){
        EncryptDecryptResponse data = cipherService.testDecryption(textCipherRequest);
        return ResponseEntity.ok(data);
    }

    @PostMapping("/admin/update")
    public ResponseEntity  updateCipherMethodForFiles(@Valid @RequestBody UpdateCipherMethodRequest updateCipherMethodRequest){
        cipherService.updateCipherMethodForFiles(updateCipherMethodRequest);
        return ResponseEntity.ok(new SuccessResponse());
    }


    @PostMapping("/admin/updatekeys")
    public ResponseEntity  updateKey(@Valid @RequestBody UpdateKeyRequest updateKeyRequest){
        cipherService.updateCipherKeys(updateKeyRequest);
        return ResponseEntity.ok(new SuccessResponse());
    }



    @PostMapping("/admin/setsecret")
    public ResponseEntity  setSecret(@Valid @RequestBody SetSecretRequest setSecretRequest){
        cipherService.setSecret(setSecretRequest);
        return ResponseEntity.ok(new SuccessResponse());
    }


    @GetMapping("/admin/get/{method}")
    public ResponseEntity loadMethod(@PathVariable("method") String cipherMethodName){
        CipherMethodResponse cipherMethod = cipherService.loadCipherMethod(cipherMethodName);
        return ResponseEntity.ok(cipherMethod);
    }


    @GetMapping("/admin/lndfiles")
    public ResponseEntity searchForLndFiles(
                                            @RequestParam("filterValue") Optional<String> filterValue,
                                            @RequestParam("page") Optional<Integer> pageNumber,
                                            @RequestParam("size") Optional<Integer> pageSize){
        int currentPage = pageNumber.orElse(1);
        int amount = pageSize.orElse(50);
        return ResponseEntity.ok(cipherService.searchLndFiles(filterValue.orElse(null),  currentPage,  amount));
    }

    @GetMapping("/admin/options")
    public ResponseEntity loadAdminFormOptions(){
        Map<String, Object> filterOptionMap = new HashMap<String, Object>();
        List<String> cipherMethods = cipherService.getAllFoundCipherEngines();
        filterOptionMap.put("cipherMethods",cipherMethods);
        return ResponseEntity.ok(filterOptionMap);
    }

}
