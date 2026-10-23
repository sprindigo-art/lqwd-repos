package lqwd.frontend.session;

import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.User;

public class Session {

    private TokenKey tokenKey;

    private User user;

    private String sessionId;

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(String sessionId) {
        this.sessionId = sessionId;
    }

    public TokenKey getTokenKey() {
        return tokenKey;
    }

    public void setTokenKey(TokenKey tokenKey) {
        this.tokenKey = tokenKey;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }

}
