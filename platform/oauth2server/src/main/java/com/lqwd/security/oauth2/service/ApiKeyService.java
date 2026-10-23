package com.lqwd.security.oauth2.service;


import com.lqwd.security.oauth2.model.security.ApiKey;
import com.lqwd.security.oauth2.repository.ApiKeyRepository;
import org.springframework.beans.factory.annotation.Autowired;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class ApiKeyService {

    @Autowired
    ApiKeyRepository apiKeyRepository;

    public ApiKey checkApikey(String apikey){

        Optional<ApiKey> oapiKey = apiKeyRepository.findByApiKey(apikey);
        if(oapiKey.isPresent() && oapiKey.get().getStatus().equals("active")){
            return oapiKey.get();
        } else {
            return null;
        }
    }

    public ApiKey addoneApikey(ApiKey apikey){
        if(apikey.getStatus().equals("active")){
            apikey.addOne();
            apiKeyRepository.save(apikey);
            return apikey;
        } else {
            return null;
        }
    }

    public ApiKey deactivateApikey(ApiKey apikey) {
        if(apikey.getStatus().equals("active")){
            apikey.setStatus("deactivated");
            apiKeyRepository.save(apikey);
            return apikey;
        } else {
            return null;
        }
    }
    
    public List<ApiKey> findAllByUser(UUID user_id) {
    	return apiKeyRepository.findAllByUser(user_id);
    }
}
