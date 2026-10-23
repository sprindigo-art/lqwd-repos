package com.lqwd.services;

import com.lqwd.AbstractTest;
import com.lqwd.interfaces.CacheStore;
import org.junit.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.junit.Assert.assertEquals;

public class CacheStoreTest extends AbstractTest {

    @Autowired
    private CacheStore cacheStore;


    @Test
    public void testInsertAndExpiry() throws InterruptedException {

        cacheStore.insert("test", 2, "A great big world");
        Thread.sleep(3000);
        String value = cacheStore.retrieve("test");

        assertEquals(null, value);

    }

    @Test
    public void testInsertAndRetrieval() {

        cacheStore.insert("test2", "A great big world");
        String value = cacheStore.retrieve("test2");

        assertEquals("A great big world", value);

    }



}