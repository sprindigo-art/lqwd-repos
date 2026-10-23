package com.lqwd.service;

import com.lqwd.model.LndAccessUser;
import com.lqwd.repository.LndAccessUserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class LndAccessUserService {

    //time in milliseconds
    public static Long timediffer = 10000L;
    public static int countNumber = 100;
    @Autowired
    LndAccessUserRepository lndAccessUserRepository;

    public boolean checkAndUpdate(String apikey){

        Optional<LndAccessUser> lndAccessUser = lndAccessUserRepository.findByApikey(apikey);

        if(lndAccessUser.isPresent()){
            Long currentTime = System.currentTimeMillis();
            Long tdif = currentTime - lndAccessUser.get().getLastUpdate();
            if( tdif < timediffer){
                if(countNumber < lndAccessUser.get().getCount()){
                    lndAccessUser.get().setCount(lndAccessUser.get().getCount()+1);
                    lndAccessUserRepository.save(lndAccessUser.get());
                } else {
                    // we rich time and number request
                    return false;
                }
            } else {
               lndAccessUser.get().setLastUpdate(System.currentTimeMillis());
               lndAccessUser.get().setCount(0);
               lndAccessUserRepository.save(lndAccessUser.get());
            }
        } else {
            LndAccessUser lndAccessUser1 = new LndAccessUser();
            lndAccessUser1.setCount(0);
            lndAccessUser1.setApikey(apikey);
            lndAccessUser1.setLastUpdate(System.currentTimeMillis());
            lndAccessUserRepository.save(lndAccessUser1);
        }

        return true;
    }
}
