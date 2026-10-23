package com.lqwd.security.oauth2.model.response;


import com.lqwd.security.oauth2.model.security.Role_;

import java.io.Serializable;
import java.util.Collection;


public class JwtResponse implements Serializable {

	private static final long serialVersionUID = -8091879091924046844L;

	private final String jwttoken;

	private final Collection<Role_> roles;



	public JwtResponse(String jwttoken, Collection<Role_> roles) {
		this.jwttoken = jwttoken;
		this.roles= roles;

	}

	public Collection<Role_> getRoleAccountList() {
		return roles;
	}

	public String getToken() {
		return this.jwttoken;
	}
}