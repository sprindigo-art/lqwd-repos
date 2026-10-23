package com.lqwd.messaging.config;

import com.lqwd.messaging.interfaces.CacheStore;
import com.lqwd.messaging.interfaces.RedisCacheStore;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CacheStoreConfig {

    private final AppProperties properties;

    @Bean
    public CacheStore cacheStore(){
        return new RedisCacheStore(properties.getRedisHost(),
                properties.getRedisPort(), properties.getRedisCred());
    }
}
