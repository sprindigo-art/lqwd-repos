package com.lqwd.service;

import com.lqwd.model.MacaroonV2;
import com.lqwd.repository.MacaroonV2Repository;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.PrintWriter;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

@Service
public class MacaroonV2Service {

    @Autowired
    MacaroonV2Repository macaroonV2Repository ;


    @Autowired
    EncryptService encryptService;

    @Autowired
    HikariDataSource dataSource;


    public String getMacaroonV2Key(String filename, String hostname) throws GeneralSecurityException, IOException, SQLException {

        String key=null;

        Optional<MacaroonV2> macaroonv2 = macaroonV2Repository.findByLikeFilenameAndHostname("%"+filename,hostname);

        if(macaroonv2.isPresent()){
              byte[] bkey = encryptService.decryptString(macaroonv2.get().getOriginalSfile());
              key = MacaroonV2.bytesToHex(bkey);
        }

        return key;
    }

   public List<MacaroonV2> findAllWatchtowers(){
        List<MacaroonV2> listWatchtowers = macaroonV2Repository.findAllWatchtowers();
        return listWatchtowers;
   }


    public String saveTlsfile(String filename, String hostname) throws SQLException {
        String key=null;
        Connection conn = dataSource.getConnection();
        Optional<MacaroonV2> macaroon = macaroonV2Repository.findByFilenameAndHostname(filename,hostname);
        String tls = "tls.cert";
        if(macaroon.isPresent()){

            try (PrintWriter out = new PrintWriter(tls)) {
                String filedata = new String(macaroon.get().getSfile());
                out.println(filedata);
                out.close();
            } catch (FileNotFoundException e) {
                System.out.println(e.getMessage());
            }
        }
        conn.close();
        return tls;
    }
}
