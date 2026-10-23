package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.model.security.Authority;
import com.lqwd.security.oauth2.repository.AuthorityRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;

@Service
public class AuthorityService {
    @Autowired
    private AuthorityRepository authorityRepository;

    public Collection<Authority> findByName(String name){
        Collection<Authority> authorities = authorityRepository.findByName(name);
        return authorities;
    }
}
