package com.lqwd.security.oauth2.dto;

import java.util.List;
import java.util.UUID;

import javax.validation.constraints.NotBlank;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RoleDTO {
	
	private String id;
	
	@NotBlank(message = "Name is mandatory")
	private String name;
	 
	private String status;
	
	
	private String mserviceId;
	
	
	
}
