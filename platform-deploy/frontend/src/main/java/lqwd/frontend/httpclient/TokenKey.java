package lqwd.frontend.httpclient;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;


import java.io.IOException;
import java.io.Serializable;
import java.util.List;
import java.util.stream.Collectors;


@Component
public class TokenKey implements Serializable {

	private static Logger logger = LoggerFactory.getLogger(TokenKey.class);

	private String access_token;

	private String refresh_token;

	private String token_type;

	private Integer expires_in;

	private String scope;

	private List<String> roles;

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

	public List<String> getRoles() {
		return roles;
	}

	public void setRoles(List<String> roles) {
		this.roles = roles;
	}

	public TokenKey() {

	}

	public TokenKey mapContent(String content) {
		ObjectMapper mapper = new ObjectMapper()
				.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

		TokenKey tokenKey = new TokenKey();
		try {

			JsonNode jsonNodeRoot = mapper.readTree(content);
			tokenKey = (TokenKey) mapper.readValue(jsonNodeRoot.get("object").asText(), TokenKey.class);
			
		} catch (IOException e) {
			logger.error(e.getMessage());
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

	@Override
	public String toString(){

		return "\nAccess Token: " + this.getAccess_token() + "\n"
				+ "Refresh Token: " + this.getRefresh_token() + "\n"
				+ "Type: " + this.getToken_type() + "\n"
				+ "Scope: " + this.getScope() + "\n"
				+ "Expires: " + this.getExpires_in()
				+ "Roles: " + this.getRoles().stream().collect(Collectors.joining(","));
	}
}
