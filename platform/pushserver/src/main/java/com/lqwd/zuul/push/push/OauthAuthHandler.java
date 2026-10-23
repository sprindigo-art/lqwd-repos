package com.lqwd.zuul.push.push;

import org.json.JSONObject;

import java.io.IOException;
import java.net.Authenticator;
import java.net.ConnectException;
import java.net.PasswordAuthentication;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class OauthAuthHandler {

    private String authorizationServerURL;
    private String clientId;
    private String clientSecret;

    public OauthAuthHandler(String url, String clientId, String clientSecret) {
        this.authorizationServerURL = url;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    public String checkToken(String accessToken) throws URISyntaxException, IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(new URI(String.format("%s?token=%s", this.authorizationServerURL,
                        accessToken)))
                .GET()
                .build();

        HttpResponse<String> response = HttpClient.newBuilder()
                .authenticator(new Authenticator() {
                    @Override
                    protected PasswordAuthentication getPasswordAuthentication() {
                        return new PasswordAuthentication(
                                clientId,
                                clientSecret.toCharArray());
                    }
                }).build()
                .send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            throw new ConnectException(response.body());
        }

        JSONObject object = new JSONObject(response.body());

        if (!object.has("user_detail")) {
            throw new ConnectException("Status code was not 200");
        }

        return object.getJSONObject("user_detail").getString("userId");
    }
}
