package com.lqwd.zuul.push.push;

import com.lqwd.zuul.push.Bootstrap;
import com.netflix.config.DynamicIntProperty;
import com.netflix.config.DynamicStringProperty;
import com.netflix.zuul.netty.server.push.PushConnection;
import com.netflix.zuul.netty.server.push.PushConnectionRegistry;
import com.netflix.zuul.netty.server.push.PushProtocol;
import com.netflix.zuul.netty.server.push.PushRegistrationHandler;
import com.netflix.zuul.netty.server.push.PushUserAuth;
import io.netty.channel.ChannelHandlerContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import redis.clients.jedis.JedisPooled;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RedisPushRegistryHandler extends PushRegistrationHandler {

    private static final Logger logger = LoggerFactory.getLogger(RedisPushRegistryHandler.class);

    private ExecutorService executorService;
    private JedisPooled jedisPooled;

    public RedisPushRegistryHandler(PushConnectionRegistry pushConnectionRegistry,
                                    PushProtocol pushProtocol) {
        super(pushConnectionRegistry, pushProtocol);
        executorService = Executors.newFixedThreadPool(10);

        initializeRedisClient();
    }

    private void initializeRedisClient(){

        int port = new DynamicIntProperty("redis.port", 6379).get();
        String host = new DynamicStringProperty("redis.host", "localhost").get();
        String password = new DynamicStringProperty("redis.credential", null).get();

        this.jedisPooled = new JedisPooled(host, port, null, password);
    }
    @Override
    protected void registerClient(ChannelHandlerContext ctx, PushUserAuth authEvent,
                                  PushConnection conn, PushConnectionRegistry registry) {

        super.registerClient(ctx,authEvent,conn,registry);

        String serverInstanceIp = System.getenv("POD_IP") == null ? "127.0.0.1"
                : System.getenv("POD_IP");

        logger.info("{} connected to {}", authEvent.getClientIdentity(), serverInstanceIp);

        executorService.execute(() -> jedisPooled.set(authEvent.getClientIdentity(), serverInstanceIp));

        conn.sendPushMessage("{\"messageType\": \"NOTIFICATION, EVENT\",\"eventType\": \"CONNECTED\",\"data\": {\"title\": \"Connected\",\"body\": \"long text\"},\"timestamp\": 1652874736}");

    }
}
