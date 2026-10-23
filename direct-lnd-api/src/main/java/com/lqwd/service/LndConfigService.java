package com.lqwd.service;

import com.lqwd.model.LndConfig;
import com.lqwd.repository.LndConfigRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class LndConfigService {

    @Autowired
    LndConfigRepository lndConfigRepository;

    public LndConfig getNext(){

        Optional<LndConfig> olndConfig = lndConfigRepository.findByStatus("free");

        if(olndConfig.isPresent()){
            return olndConfig.get();
        }
        return null;
    }

    public LndConfig getLast(){

        Optional<LndConfig> olndConfig = lndConfigRepository.findLast();

        if(olndConfig.isPresent()){
            return olndConfig.get();
        }
        return null;
    }

    private String addOne(String strForInt){
        Integer integer = Integer.parseInt(strForInt);
        integer++;
        return Integer.toString(integer);
    }

    public void generateNewConfigs(){

        for (int i = 0; i < 2; i++) {
            Optional<LndConfig> last = lndConfigRepository.findLast();
            LndConfig  lndConfig = new LndConfig("slnd");
            if(last.isPresent()){
                lndConfig = last.get();
                lndConfig.setPort8080(addOne(lndConfig.getPort8080()));
                lndConfig.setPort835(addOne(lndConfig.getPort835()));
                lndConfig.setPort9735(addOne(lndConfig.getPort9735()));
                lndConfig.setPort10009(addOne(lndConfig.getPort10009()));
                lndConfig.setPort29088(addOne(lndConfig.getPort29088()));
                lndConfig.setPort29099(addOne(lndConfig.getPort29099()));
                lndConfig.setLabel("uldn"+addOne(lndConfig.getId().toString()));
                lndConfig.setStatus("free");
            } else {
                lndConfig.setPort8080("8880");
                lndConfig.setPort835("1635");
                lndConfig.setPort9735("10535");
                lndConfig.setPort10009("10809");
                lndConfig.setPort29088("29888");
                lndConfig.setPort29099("29899");
                lndConfig.setLabel("uldn1");
                lndConfig.setStatus("free");
                lndConfig.setServiceexternalip("192.168.123.252");
                lndConfig.setNodetype("NodePort");
                lndConfig.setLndpassphrase("LqWD_is_theBestCompany2020");
                lndConfig.setLndpassword("2020LQWd_mainPass!");
                lndConfig.setLndexternalip("192.243.215.232");
                lndConfig.setLndalias("LND_LQWD");
                lndConfig.setLndrpcuser("bitcoin");
                lndConfig.setLndrpcpass("bitcoin12coin11Andb7");
                lndConfig.setLndrpchost("192.168.123.252");
                lndConfig.setVolumename("lnd");
                lndConfig.setVolumepath("/root/.lnd");
                lndConfig.setNamespace("user-lnd");
                lndConfig.setImage("localhost:32000/lndv2:latest");
            }

            lndConfigRepository.save(lndConfig);
        }
    }

    public void update(LndConfig lndConfig) {
        lndConfigRepository.save(lndConfig);
    }

    public LndConfig getLndnodeByName(String lndnodename) {
        Optional<LndConfig> optionalLndConfig = lndConfigRepository.findByLndnodename(lndnodename);
        if(optionalLndConfig.isPresent()){
            return optionalLndConfig.get();
        }
        return null;
    }
}
