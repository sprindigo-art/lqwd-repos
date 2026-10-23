package com.lqwd.breez.config.httpclient.lnd;

import com.google.crypto.tink.Aead;
import com.google.crypto.tink.CleartextKeysetHandle;
import com.google.crypto.tink.JsonKeysetReader;
import com.google.crypto.tink.KeysetHandle;
import com.google.crypto.tink.aead.AeadConfig;
import com.lqwd.breez.exceptions.ApiException;
import com.lqwd.breez.model.LndNodeFile;
import com.lqwd.breez.repository.LndFileRepository;
import lombok.SneakyThrows;
import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;
import org.apache.http.HttpStatus;
import javax.xml.bind.DatatypeConverter;
import java.io.File;
import java.io.IOException;
import java.util.Optional;


/**
 * Intercepts  http request made to lnd server to include macaroon header
 */

public class LndHttpInterceptor implements Interceptor {

    LndFileRepository lndFileRepository;
    String lndNodeName;
    String secretKeyPath;

    LndHttpInterceptor(LndFileRepository lndFileRepository, String nodeName, String secretKeyPath){
        this.lndFileRepository = lndFileRepository;
        this.lndNodeName = nodeName;
        this.secretKeyPath = secretKeyPath;
    }


    @Override
    @SneakyThrows
    public Response intercept(Chain chain) throws IOException {
        String macaroon = null;
        Optional<LndNodeFile> lndNodeFile = lndFileRepository.findByFilenameAndNodeName("/data/v3/"+lndNodeName+"/data/chain/bitcoin/regtest/admin.macaroon",lndNodeName);
        if(lndNodeFile.isPresent()){
            AeadConfig.register();
            KeysetHandle keysetHandle = CleartextKeysetHandle.read(JsonKeysetReader.withFile(new File(secretKeyPath)));
            Aead decryption = keysetHandle.getPrimitive(Aead.class);
            byte[] decryptedCipherTextBytes = decryption.decrypt(lndNodeFile.get().getSfile(), LndConstants.ASSOCIATED_DATA.getBytes());
            macaroon = DatatypeConverter.printHexBinary(decryptedCipherTextBytes);
        }

        if(macaroon != null){
            Request retrofit_request = chain.request();
            Request newReq = retrofit_request.newBuilder()
                    .addHeader(LndConstants.MACAROON_HEADER,macaroon)
                    .build();
            return chain.proceed(newReq);
        }else{
            throw new ApiException(HttpStatus.SC_BAD_REQUEST,"Macaroon file not found");
        }
    }
}
