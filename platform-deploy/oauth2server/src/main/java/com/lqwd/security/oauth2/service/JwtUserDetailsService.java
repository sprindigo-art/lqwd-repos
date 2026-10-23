package com.lqwd.security.oauth2.service;


import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

@Service
@RequiredArgsConstructor
public class JwtUserDetailsService implements UserDetailsService {


	private final UserRepository userRepository;


	@Override
	@Transactional
	public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
		User_ user = userRepository.findByUsername(username).orElseThrow(() ->
		new UsernameNotFoundException("User not found with username: " + username));

		Collection<Role_> existingRoleIds = user.getRole_s();

		List<SimpleGrantedAuthority> grantedAuthorities = new ArrayList<>();

		for (Role_ r : existingRoleIds){
			grantedAuthorities.add(new SimpleGrantedAuthority(r.getName()));
		}

		return new org.springframework.security.core.userdetails.User(user.getUsername(), user.getPassword(),grantedAuthorities);
	}


}