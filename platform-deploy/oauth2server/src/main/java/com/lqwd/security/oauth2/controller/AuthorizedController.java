package com.lqwd.security.oauth2.controller;

import com.lqwd.security.oauth2.config.encryption.Encoders;
import com.lqwd.security.oauth2.config.utils.JwtTokenUtil;
import com.lqwd.security.oauth2.model.request.JwtRequest;
import com.lqwd.security.oauth2.model.response.JwtResponse;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.service.JwtUserDetailsService;
import com.lqwd.security.oauth2.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/authorize")
public class AuthorizedController {

    @Autowired
    private AuthenticationManager authenticationManager;

    @Autowired
    private JwtUserDetailsService jwtUserDetailsService;

    @Autowired
    private UserService userService;

    @Autowired
    private JwtTokenUtil jwtTokenUtil;

    @Autowired
    private Encoders encoders;

    @RequestMapping(method = RequestMethod.POST)
    public ResponseEntity<?> createAuthenticationToken(@RequestBody JwtRequest authenticationRequest) throws Exception {

        authenticate(authenticationRequest.getUsername(), authenticationRequest.getPassword());

        final UserDetails userDetails = jwtUserDetailsService
                .loadUserByUsername(authenticationRequest.getUsername());

        final User_ user = userService.findByUsername(authenticationRequest.getUsername());

        final String token = jwtTokenUtil.generateToken(user);

        return ResponseEntity.ok(new JwtResponse(token, user.getRole_s()));
    }

    private void authenticate(String username, String password) throws Exception {
        try {
            authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(username, password));
        } catch (DisabledException e) {
            throw new Exception("USER_DISABLED", e);
        } catch (BadCredentialsException e) {
            throw new Exception("INVALID_CREDENTIALS", e);
        }
    }

    @RequestMapping(method = RequestMethod.GET, produces = MediaType.TEXT_HTML_VALUE)
    @ResponseStatus(value = HttpStatus.OK)
    public ResponseEntity getAuthorizeToken(@RequestParam String client_id,
                                            @RequestParam String client_type,
                                            @RequestParam String redirect_uri
    ) {


        String result = "OK";
        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.CONTENT_TYPE, "application/json; charset=UTF-8");

        return ResponseEntity.ok().headers(headers).body(result);

    }

    @PostMapping("/check_credentials")
    public ResponseEntity checkCredentials(@RequestParam String password,
                                            @RequestParam String username
    ) {


        User_ user  = userService.findByUsernameOrEmail(username).orElse(null);

        if (user == null){
            return ResponseEntity.status(400).body("Invalid username or password");
        }


        if (!encoders.oauthClientPasswordEncoder().matches(password, user.getPassword())){
            return ResponseEntity.status(400).body("Invalid username or password");
        }

        return ResponseEntity.ok().body("credentials valid");
    }


    @PostMapping("/authenticate")
    public ResponseEntity checkCredentials(OAuth2Authentication authentication,
                                           @RequestParam String password
    ) {

        User_ user = userService.findByUsernameOrEmail(authentication.getName()).orElse(
                null
        );

        if (user == null){
            return ResponseEntity.status(400).body("Invalid credential");
        }


        if (!encoders.oauthClientPasswordEncoder().matches(password, user.getPassword())){
            return ResponseEntity.status(400).body("Invalid credential");
        }

        return ResponseEntity.ok().body("Authentication successful");
    }
}
