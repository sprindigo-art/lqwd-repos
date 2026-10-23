package com.lqwd.cipherengine;

import com.google.crypto.tink.CleartextKeysetHandle;
import com.google.crypto.tink.JsonKeysetReader;
import com.google.crypto.tink.KeysetHandle;
import com.lqwd.exception.CipherEngineException;
import com.lqwd.model.entity.CipherMethod;
import com.lqwd.repository.CipherMethodRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.BeanNameAware;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.Optional;

@Component
public class BaseCipherEngineComponent implements BeanNameAware {

    Logger logger = LoggerFactory.getLogger(BaseCipherEngineComponent.class);

    @Value("${app.cipher_asd}")
    String associatedData;

    protected String componentName;

    private String secretKey;

    @Autowired
    private CipherMethodRepository cipherMethodRepository;

    @Override
    public void setBeanName(String beanName) {
        this.componentName = beanName;
    }


    /**
     * Get associated cipher method
     * @return
     */
    CipherMethod getCipherMethod(){
        Optional<CipherMethod> result = cipherMethodRepository.findByName(componentName);
        if(result.isPresent()){
            return result.get();
        }else{
            throw new CipherEngineException("Cipher Method not yet registered in db : " + componentName);
        }
    }


    /**
     * Gets the keyset handle
     *
     * @return
     * @throws GeneralSecurityException
     * @throws IOException
     */
    KeysetHandle getPrivateKeysetHandle() throws GeneralSecurityException, IOException {
        CipherMethod cipherMethod = getCipherMethod();
        KeysetHandle handle = CleartextKeysetHandle.read(JsonKeysetReader.
                withString(new String(Base64.getDecoder().decode(cipherMethod.getSecretKey().getBytes()))));
        return handle;
    }

    KeysetHandle getPrivateKeysetHandle(String secretKey) throws GeneralSecurityException, IOException {
       KeysetHandle handle = CleartextKeysetHandle.read(JsonKeysetReader.
                withString(secretKey));
        return handle;
    }


}
