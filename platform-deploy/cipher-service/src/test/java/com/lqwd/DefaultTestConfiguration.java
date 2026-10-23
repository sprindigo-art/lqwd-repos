package com.lqwd;

import com.lqwd.cipherengine.AeadCipherEngine;
import com.lqwd.cipherengine.BaseCipherEngineComponent;
import com.lqwd.cipherengine.HybridCipherEngine;
import com.lqwd.config.CipherEngineConfig;
import com.lqwd.config.InitDefaultCipherEngine;
import com.lqwd.config.KubernetesConfig;
import com.lqwd.config.ResourceServerConfig;
import com.lqwd.interfaces.CipherEngineFactory;
import com.lqwd.service.CipherService;
import com.lqwd.service.KubenetesService;
import org.springframework.boot.autoconfigure.security.oauth2.OAuth2AutoConfiguration;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;

@TestConfiguration
@Import({ResourceServerConfig.class, OAuth2AutoConfiguration.class, KubernetesConfig.class,  KubenetesService.class,CipherService.class,  BaseCipherEngineComponent.class, CipherEngineConfig.class, AeadCipherEngine.class, HybridCipherEngine.class})
public class DefaultTestConfiguration {
}
