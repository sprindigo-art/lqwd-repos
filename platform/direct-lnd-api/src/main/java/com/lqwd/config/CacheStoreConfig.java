package com.lqwd.config;

import com.lqwd.interfaces.CacheStore;
import com.lqwd.service.RedisCacheStore;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CacheStoreConfig {

    private final AppProperties properties;

    @Bean
    public CacheStore cacheStore(){
        return new RedisCacheStore(properties.getRedis_host(),
                properties.getRedis_port(), properties.getRedis_cred());
    }
}
