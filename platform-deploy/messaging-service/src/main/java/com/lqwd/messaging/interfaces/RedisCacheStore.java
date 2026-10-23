package com.lqwd.messaging.interfaces;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;
import redis.clients.jedis.Jedis;
import sun.reflect.generics.reflectiveObjects.NotImplementedException;


public class RedisCacheStore implements CacheStore {

    Logger logger = LoggerFactory.getLogger(RedisCacheStore.class);

    Jedis jedis;

    public RedisCacheStore(String hostname, int port, String cred){
        initStore(hostname, port, cred);
    }

    @Override
    public void initStore(String hostname, int port, String cred) {
        logger.info("initializing redis");
        jedis = new Jedis(hostname, port);
        if(!StringUtils.isEmpty(cred)) {
            jedis.auth(cred);
        }
        logger.info("Redis connection successful");
    }

    @Override
    public String retrieve(String key) {
        return jedis.get(key);
    }

    @Override
    public void insert(String key, String value) {
        throw new NotImplementedException();
    }

    @Override
    public void insert(String key, long exp, String value) {
        throw new NotImplementedException();
    }


}
