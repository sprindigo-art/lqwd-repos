package com.lqwd.httpclient;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;

public class TokenKey {

	private String access_token;

	private String refresh_token;

	private String token_type;

	private Integer expires_in;

	private String scope;

	private Long requestedSystemTime;

	public String getRefresh_token() {
		return refresh_token;
	}

	public void setRefresh_token(String refresh_token) {
		this.refresh_token = refresh_token;
	}

	public String getAccess_token() {
		return access_token;
	}

	public void setAccess_token(String access_token) {
		this.access_token = access_token;
	}

	public String getToken_type() {
		return token_type;
	}

	public void setToken_type(String token_type) {
		this.token_type = token_type;
	}

	public Integer getExpires_in() {
		return expires_in;
	}

	public void setExpires_in(Integer expires_in) {
		this.expires_in = expires_in;
	}

	public Long getRequestedSystemTime() {
		return requestedSystemTime;
	}

	public void setRequestedSystemTime(Long requestedSystemTime) {
		this.requestedSystemTime = requestedSystemTime;
	}

	public String getScope() {
		return scope;
	}

	public void setScope(String scope) {
		this.scope = scope;
	}

	public TokenKey() {

	}

	public TokenKey mapContent(String content) {
		ObjectMapper mapper = new ObjectMapper();
		TokenKey tokenKey = new TokenKey();
		try {
			tokenKey = (TokenKey) mapper.readValue(content, TokenKey.class);

		} catch (IOException e) {
			e.printStackTrace();
		}
		return tokenKey;
	}

	public boolean checkExpires_in(Long timeNowInSec) {
		if ((timeNowInSec - requestedSystemTime) > (expires_in - 10)) {
			return false;
		} else {
			return true;
		}

	}
}
