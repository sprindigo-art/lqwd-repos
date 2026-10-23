/**
 * Copyright 2018 Netflix, Inc.
 * <p>
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * <p>
 * http://www.apache.org/licenses/LICENSE-2.0
 * <p>
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.lqwd.zuul.push.push;

import com.google.common.base.Strings;
import com.netflix.config.DynamicStringProperty;
import com.netflix.zuul.message.http.Cookies;
import com.netflix.zuul.netty.server.push.PushUserAuth;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.cookie.Cookie;
import io.netty.handler.codec.http.FullHttpRequest;
import io.netty.handler.codec.http.HttpResponseStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URISyntaxException;

/**
 * Takes cookie value of the cookie "userAuthCookie" as a customerId WITHOUT ANY actual validation.
 * For sample puprose only. In real life the cookies at minimum should be HMAC signed to prevent tampering/spoofing,
 * probably encrypted too if it can be exchanged on plain HTTP.
 *
 * Author: Susheel Aroskar
 * Date: 5/16/18
 */
@ChannelHandler.Sharable
public class PushAuthHandler extends com.netflix.zuul.netty.server.push.PushAuthHandler {

    private static final Logger logger = LoggerFactory.getLogger(PushAuthHandler.class);

    public static final DynamicStringProperty OAUTH_URL = new DynamicStringProperty("zuul.push.auth.oauth.url", "");
    public static final DynamicStringProperty CLIENT_ID = new DynamicStringProperty("zuul.push.auth.oauth.client-id", "");
    public static final DynamicStringProperty CLIENT_SECRET = new DynamicStringProperty("zuul.push.auth.oauth.client-secret", "");

    private OauthAuthHandler handler;

    public PushAuthHandler(String path) {
        super(path, ".sample.netflix.com");
        handler = new OauthAuthHandler(OAUTH_URL.get(), CLIENT_ID.get(),
                CLIENT_SECRET.get());
    }

    /**
     * We support only cookie based auth in this sample
     */
    @Override
    protected boolean isDelayedAuth(FullHttpRequest req, ChannelHandlerContext ctx) {
        return false;
    }

    @Override
    protected PushUserAuth doAuth(FullHttpRequest req) {
        final Cookies cookies = parseCookies(req);
        for (final Cookie c : cookies.getAll()) {
            if (c.name().equals("userAuthCookie")) {
                final String accessToken = c.value();
                if (!Strings.isNullOrEmpty(accessToken)) {
                    try {
                        String custId = this.handler.checkToken(accessToken);
                        return new CustomPushUserAuth(custId);
                    } catch (URISyntaxException | IOException | InterruptedException e) {
                        logger.info("An error occurred on authentication: {}", e.getMessage());
                    }
                }
            }
        }

        return new CustomPushUserAuth(HttpResponseStatus.UNAUTHORIZED.code());
    }

}
