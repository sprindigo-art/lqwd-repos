package com.lqwd.messaging.interfaces;

public interface CacheStore {

    void initStore(String hostname, int port, String cred);

    String retrieve(String key);

    void insert(String key, String value);

    void insert(String key, long exp, String value);
}
