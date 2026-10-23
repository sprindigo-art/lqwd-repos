package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.model.security.User_Details;
import com.lqwd.security.oauth2.repository.User_DetailsRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

@Service
public class User_DetailsService {

    @Autowired
    private User_DetailsRepository user_detailsRepository;

    public User_Details save(User_Details user_details){
        return user_detailsRepository.save(user_details);
    }

    public Optional<User_Details> findById(UUID id){
        return user_detailsRepository.findById(id);
    }


}
