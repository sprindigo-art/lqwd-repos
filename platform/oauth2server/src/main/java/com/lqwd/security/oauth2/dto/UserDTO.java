package com.lqwd.security.oauth2.dto;

import java.util.Date;
import java.util.List;
import java.util.UUID;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

import com.lqwd.security.oauth2.model.security.User_;
import lombok.*;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserDTO {
	
	private String id;
	
	@NotBlank(message = "username is mandatory")
	private String username;
	 
	@NotBlank(message = "email is mandatory")
	private String email;

	private int noOfLndNodes;

	private int noOfApiKeys;

	private String lastAccess;
	private String createdAt;
	private String updatedAt;

	private String password;

	private Boolean accountExpired;
	
	private Boolean accountLocked;
	
	private Boolean credentialsExpired;
	
	private Boolean enabled;

	@NotBlank(message = "firstname is mandatory")
	private String firstName;
	
	private String lastName;
	
	private String phone;
	
	private Boolean receiveNews;
	
	private Boolean fa2;

	@NotNull(message = "account_type is mandatory")
	private Long accountTypeId;
	
	private int allowedNoOfLnd;

	private String accountTypeName;

	private String status;
	
	private List<String> roleIds;


	private Double liquidityFee;


}
