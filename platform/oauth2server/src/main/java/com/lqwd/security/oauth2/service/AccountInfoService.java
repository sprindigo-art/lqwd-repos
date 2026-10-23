package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.model.security.AccountInfo;
import com.lqwd.security.oauth2.repository.AccountInfoRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class AccountInfoService {

    @Autowired
    private AccountInfoRepository accountInfoRepository;

    public AccountInfo save(AccountInfo accountInfo){
        return accountInfoRepository.save(accountInfo);
    }


}
