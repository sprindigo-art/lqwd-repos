package com.lqwd.security.oauth2.model.request;

import java.io.Serializable;

public class JwtRequest implements Serializable {

    private static final long serialVersionUID = 5926468583005150707L;

    private String username;
    private String password;
    private String namespace;

    public JwtRequest() {

    }

    public JwtRequest(String username, String password, String namespace) {
        this.setUsername(username);
        this.setPassword(password);
        this.setNamespace(namespace);
    }

	public String getNamespace() {
		return namespace;
	}

	public void setNamespace(String namespace) {
		this.namespace = namespace;
	}

	public String getUsername() {
        return this.username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return this.password;
    }

    public void setPassword(String password) {
        this.password = password;
    }
}