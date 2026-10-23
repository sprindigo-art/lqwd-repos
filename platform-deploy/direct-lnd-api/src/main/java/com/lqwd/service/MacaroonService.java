package com.lqwd.service;

import com.lqwd.model.entities.Macaroon;
import com.lqwd.repository.MacaroonRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class MacaroonService {

    private final MacaroonRepository macaroonRepository ;
    private final EncryptService encryptService;


    public String getMacaroonKey(String filename, String nodeName, String passphrase){
        byte[] bkey = getMacaroonKeyAsByte(filename, nodeName, passphrase);
        return Macaroon.bytesToHex(bkey);
    }

    public byte[]  getMacaroonKeyAsByte(String filename, String nodeName,String passphrase){
        return encryptService.decrypt(filename, nodeName,  passphrase);
    }

    public Macaroon getMacaroon(String filename, String nodeName) {

       return macaroonRepository.findByLikeFilenameAndNodename("%"+filename,nodeName).orElse(null);

    }

    public String addCipherFiles(String lndNodeName, String passphrase, String new_passphrase, String email) {
        String response = encryptService.addCipherFilesForShared(lndNodeName, passphrase, new_passphrase, email);
        return response;
    }
}
