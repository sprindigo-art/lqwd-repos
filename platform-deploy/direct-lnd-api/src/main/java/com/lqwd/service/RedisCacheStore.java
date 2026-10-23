package com.lqwd.service;

import com.lqwd.interfaces.CacheStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;
import redis.clients.jedis.Jedis;


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

        if(!jedis.isConnected()){
            jedis.connect();
        }

        return jedis.get(key);
    }

    @Override
    public void insert(String key, long exp, String value) {

        if(!jedis.isConnected()){
            jedis.connect();
        }

        jedis.setex(key, exp, value);

    }

    @Override
    public void insert(String key, String value) {
        if(!jedis.isConnected()){
            jedis.connect();
        }
        jedis.set(key, value);
    }

}
