package com.lqwd.config;

import com.lqwd.service.CipherService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class SheduledTask {
    @Autowired
    CipherService cipherService;

    /**
     * update lnd files to use new encryption key in the background
     * as this is a long running process.
     */
    @Scheduled(cron = "0 0/2 * * * *")
    public void reencryptWithNewCipherKeys() {
        cipherService.runDecryptAndEncryptWithUpdatedKey();
    }
}
