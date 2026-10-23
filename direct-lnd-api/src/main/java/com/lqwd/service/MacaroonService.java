package com.lqwd.service;

import com.lqwd.model.Macaroon;
import com.lqwd.repository.MacaroonRepository;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import javax.persistence.EntityManager;
import javax.persistence.EntityManagerFactory;
import javax.persistence.Persistence;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.PrintWriter;
import java.security.GeneralSecurityException;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

@Service
public class MacaroonService {

    @Autowired
    MacaroonRepository macaroonRepository ;


    @Autowired
    EncryptService encryptService;

    @Autowired
    HikariDataSource dataSource;


    public String getMacaroonKey(String filename, String externalip) throws GeneralSecurityException, IOException, SQLException {

        Connection conn = dataSource.getConnection();

        String key=null;

        Optional<Macaroon> macaroon = macaroonRepository.findByLikeFilenameAndExternalip("%"+filename,externalip);

        if(macaroon.isPresent()){
              byte[] bkey = encryptService.decryptString(macaroon.get().getOriginalSfile());
              key = this.convertKey(bkey);
        }
        conn.close();

        return key;
    }


    private static final char[] HEX_ARRAY = "0123456789ABCDEF".toCharArray();

    private static String bytesToHex(byte[] bytes) {
        char[] hexChars = new char[bytes.length * 2];
        for (int j = 0; j < bytes.length; j++) {
            int v = bytes[j] & 0xFF;
            hexChars[j * 2] = HEX_ARRAY[v >>> 4];
            hexChars[j * 2 + 1] = HEX_ARRAY[v & 0x0F];
        }
        return new String(hexChars);
    }

    public String convertKey(byte[] key) {
            return this.bytesToHex(key);

    }



    public String saveTlsfile(String filename, String externalip) throws SQLException {
        String key=null;

        Connection conn = dataSource.getConnection();

        Optional<Macaroon> macaroon = macaroonRepository.findByFilenameAndExternalip(filename,externalip);
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
