package com.lqwd.security.oauth2.dto;

import java.util.List;
import java.util.UUID;

import javax.validation.constraints.NotBlank;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class OauthClientDTO {
	
	@NotBlank(message = "clientId is mandatory")
	private String clientId;
	
	@NotBlank(message = "resourceIds is mandatory")
	private String resourceIds;
	 
	
	private String clientSecret;
	
	private String scope;
	
	private String authorizedGrantTypes;
	
	private String webServerRedirectUri;
	
	private String authorities;
	
	private String accessTokenValidity;
	
	private String refreshTokenValidity;
	
	private String additionalInformation;
	
	private String autoapprove;
	
	
	
	
	
}
