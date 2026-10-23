package com.lqwd.breez.service;

import com.lqwd.breez.model.LndNodeFile;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class LndFileServie {

    @Autowired
    com.lqwd.breez.repository.LndFileRepository lndFileRepository;


    public String getFile(String filename, String lndNode){
        Optional<LndNodeFile> macaroon = lndFileRepository.findByFilenameAndNodeName(filename,lndNode);
        if(macaroon.isPresent()){
            return macaroon.get().getFilename();
        }
        return null;
    }
}
