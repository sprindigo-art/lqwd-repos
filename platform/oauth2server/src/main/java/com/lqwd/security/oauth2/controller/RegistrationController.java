package com.lqwd.security.oauth2.controller;


import com.lqwd.security.oauth2.config.encryption.Encoders;
import com.lqwd.security.oauth2.config.utils.JwtTokenUtil;
import com.lqwd.security.oauth2.model.request.RegistrationRequest;
import com.lqwd.security.oauth2.model.request.UserRequest;
import com.lqwd.security.oauth2.model.response.ErrorResponse;
import com.lqwd.security.oauth2.model.response.F2aSecretResponse;
import com.lqwd.security.oauth2.model.response.UserResponse;
import com.lqwd.security.oauth2.model.security.AccountInfo;
import com.lqwd.security.oauth2.model.security.AccountType;
import com.lqwd.security.oauth2.model.security.Authority;
import com.lqwd.security.oauth2.model.security.ConfirmationToken;
import com.lqwd.security.oauth2.model.security.OauthClientDetails;
import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.model.security.User_Details;
import com.lqwd.security.oauth2.service.AccountTypeService;
import com.lqwd.security.oauth2.service.AuthorityService;
import com.lqwd.security.oauth2.service.ConfirmationTokenService;
import com.lqwd.security.oauth2.service.JwtUserDetailsService;
import com.lqwd.security.oauth2.service.MfaService;
import com.lqwd.security.oauth2.service.OauthClientDetailsService;
import com.lqwd.security.oauth2.service.RoleService;
import com.lqwd.security.oauth2.service.UserService;
import com.lqwd.security.oauth2.service.User_DetailsService;
import lombok.RequiredArgsConstructor;
import org.jboss.aerogear.security.otp.api.Base32;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.io.IOException;
import java.sql.Timestamp;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@RefreshScope
@RestController
@RequestMapping("/registration")
@RequiredArgsConstructor
public class RegistrationController {
    private final UserService userService;

    private final MfaService mfaService;

    private final RoleService roleService;

    private final AccountTypeService accountTypeService;

    private final User_DetailsService user_detailsService;

    private final AuthenticationManager authenticationManager;

    private final JwtUserDetailsService jwtUserDetailsService;

    private final ConfirmationTokenService confirmationTokenService;

    private final JwtTokenUtil jwtTokenUtil;


    private final Encoders encoder;


    private final AuthorityService authorityService;

    private final OauthClientDetailsService oauthClientDetailsService;


    @ResponseBody
    @PostMapping(consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    public ResponseEntity<UserResponse> registration(@RequestParam String username,
                                                     @RequestParam String password,
                                                     @RequestParam String firstname,
                                                     @RequestParam String lastname,
                                                     @RequestParam String companyname,
                                                     @RequestParam String servicename) throws Exception {

        User_Details user_Details = new User_Details();
        user_Details.setFirstName(firstname);
        user_Details.setLastName(lastname);
        user_Details.setId(UUID.randomUUID());
        user_Details = user_detailsService.save(user_Details);


        // Ensure that new users are not automatically saved with admin role.
        // To be elevated to admin, an existing admin user should that via admin backend page.
        Role_ role = roleService.findAllByMserviceAndRole(servicename, "USER");
        List<Role_> role_s = role == null ? Collections.EMPTY_LIST : Arrays.asList(role);


        AccountType accountType = accountTypeService.findById();
        AccountInfo accountInfo = new AccountInfo();
        accountInfo.setAccountType(accountType);
        User_ newUser = new User_();
        newUser.setUsername(username);
        newUser.setPassword("{bcrypt}" + encoder.userPasswordEncoder().encode(password));
        newUser.setAccountExpired(false);
        newUser.setAccountLocked(false);
        newUser.setCredentialsExpired(false);
        newUser.setEnabled(true);
        newUser.setAllowedNoOfLnd(2);
        newUser.setUserDetails(user_Details);
        newUser.setRole_s(role_s);
        newUser.setAccountInfo(accountInfo);

        userService.saveUser(newUser);

        authenticate(newUser.getUsername(), newUser.getPassword());

        final UserDetails userDetails = jwtUserDetailsService
                .loadUserByUsername(newUser.getUsername());

        final User_ user = userService.findByUsername(newUser.getUsername());

        final String token = jwtTokenUtil.generateToken(user);

        return ResponseEntity.ok(new UserResponse(token, user));
    }


    @PostMapping(value = "/v2")
    public ResponseEntity<?> registrationV2(@RequestBody @Valid RegistrationRequest registrationRequest) throws Exception {

        ResponseEntity<ErrorResponse> errorResponse = preliminaryRegistrationChecks(registrationRequest);

        if (errorResponse != null) return errorResponse;


        String mfaSecret = Base32.random();

        // Ensure that new users are not automatically saved with admin role.
        // To be elevated to admin, an existing admin user should that via admin backend page.
        Role_ role = roleService.findAllByMserviceAndRole(registrationRequest.getServiceName(), "USER");
        List<Role_> role_s = role == null ? Collections.EMPTY_LIST : Arrays.asList(role);

        Collection<Authority> authorities = authorityService.findByName("ADMIN");
        AccountType accountType = accountTypeService.findById();
        AccountInfo accountInfo = new AccountInfo("free", "active");
        accountInfo.setAccountType(accountType);


        User_ newUser = new User_();
        newUser.setUsername(registrationRequest.getUsername());
        newUser.setEmail(registrationRequest.getEmail().toLowerCase());
        newUser.setPassword(encoder.userPasswordEncoder().encode(registrationRequest.getPassword()));
        newUser.setAccountExpired(false);
        newUser.setAccountLocked(false);
        newUser.setCredentialsExpired(false);
        newUser.setEnabled(true);
        newUser.setAllowedNoOfLnd(2);
        newUser.setStatus("NOTCONFIRM");
        newUser.setRole_s(role_s);
        newUser.setAuthorities(authorities);
        newUser.setAccountInfo(accountInfo);
        Timestamp timestamp = new Timestamp(System.currentTimeMillis());
        newUser.setCreatedDate(timestamp);

        if (registrationRequest.getF2a()) {
            newUser.setF2asecret(mfaSecret);
        }

        newUser = userService.saveUser(newUser);

        User_Details user_Details = new User_Details();
        user_Details.setFirstName(registrationRequest.getFirstname());
        user_Details.setLastName(registrationRequest.getLastname());
        user_Details.setFa2(registrationRequest.getF2a());
        user_Details.setUser(newUser);
        user_detailsService.save(user_Details);

        newUser.setUserDetails(user_Details);

        authenticate(registrationRequest.getUsername(), registrationRequest.getPassword());

        ConfirmationToken confirmationToken = new ConfirmationToken(newUser);

        confirmationTokenService.save(confirmationToken);

        try {
            confirmationTokenService.sendRegistrationEmail(newUser.getEmail(), confirmationToken);
        } catch (IOException e) {
            e.printStackTrace();
        }


        String mfaUrl = mfaService.generateQrURL(mfaSecret, registrationRequest.getEmail());

        return ResponseEntity.ok(new UserResponse(newUser, mfaUrl));

    }

    private ResponseEntity<ErrorResponse> preliminaryRegistrationChecks(RegistrationRequest registrationRequest) {

        if (registrationRequest.getUsername() == null) {
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .error(true).message("User name is null").build());
        }

        if (registrationRequest.getPassword() == null) {
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .error(true).message("User password is null").build());
        }

        if (registrationRequest.getPassword().length() < 5) {
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .error(true).message("Your password must have at least 5 characters").build());
        }

        if (registrationRequest.getEmail() == null) {
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .error(true).message("Email is null").build());
        }

        String regex = "^[\\w-_\\.+]*[\\w-_\\.]\\@([\\w]+\\.)+[\\w]+[\\w]$";
        if (!registrationRequest.getEmail().matches(regex)) {
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .error(true).message("Wrong email format").build());
        }

        User_ checkUser = userService.findByUsernameOrEmail(registrationRequest.getUsername(),
                registrationRequest.getEmail().toLowerCase()).orElse(null);

        if (checkUser != null)
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .error(true).message("Looks like a user already exist with the email or username provided").build());

        return null;
    }


    @PostMapping(value = "/verification/send")
    public ResponseEntity<UserResponse> sendVerification(@RequestParam String username) {

        User_ user = userService.findByEmail(username);

        if (user != null && !user.getStatus().equals("CONFIRM")) {

            ConfirmationToken confirmationToken = new ConfirmationToken(user);

            confirmationTokenService.save(confirmationToken);

            user.setStatus("NOTCONFIRM");

            userService.saveUser(user);

            try {
                confirmationTokenService.sendConfirmationEmail(user.getEmail(), confirmationToken);
            } catch (IOException e) {
                e.printStackTrace();
            }


            return ResponseEntity.ok(new UserResponse(user));

        }
        return ResponseEntity.ok(null);

    }

    @PostMapping(value = "/f2a/save")
    public ResponseEntity<F2aSecretResponse> f2aSave(@RequestParam String username, @RequestParam String f2asecret) throws Exception {

        User_ user = userService.findByUsernameOrEmail(username).orElse(null);

        if (user != null) {

            user.setF2asecret(f2asecret);

            userService.saveUser(user);

            F2aSecretResponse f2aresponse = new F2aSecretResponse();
            f2aresponse.setEmail(user.getUsername());
            f2aresponse.setSecret(user.getF2asecret());
            return ResponseEntity.ok(f2aresponse);

        }
        return ResponseEntity.ok(null);

    }


    @PostMapping(value = "/f2a/get")
    public ResponseEntity<F2aSecretResponse> f2aGet(@RequestParam String username) {

        User_ user = userService.findByUsernameOrEmail(username).orElse(null);

        if (user != null) {
            F2aSecretResponse f2aresponse = new F2aSecretResponse();
            f2aresponse.setEmail(user.getUsername());
            f2aresponse.setSecret(user.getF2asecret());
            return ResponseEntity.ok(f2aresponse);

        }
        return ResponseEntity.ok(null);

    }

    @PostMapping(value = "/checkusername")
    public ResponseEntity<String> checkUsername(@RequestParam String username) {

        User_ user = userService.findByUsernameOrEmail(username).orElse(null);

        if (user != null) {

            return ResponseEntity.ok("Username already exist");

        }
        return ResponseEntity.ok("ok");


    }

    @PostMapping(value = "/checkemail")
    public ResponseEntity<String> checkEmail(@RequestParam String email) {

        User_ user = userService.findByEmail(email);

        if (user != null) {

            return ResponseEntity.ok("Email already exist");

        }
        return ResponseEntity.ok("ok");


    }

    @RequestMapping(value = "/confirm-account", method = {RequestMethod.GET, RequestMethod.POST})
    public ResponseEntity<UserResponse> confirmationEmail(@RequestParam("token") String confirmationToken) {

        ConfirmationToken token = confirmationTokenService.findByConfirmationToke(confirmationToken);

        if (token != null) {
            User_ user = token.getUser();
            user.setStatus("CONFIRM");
            userService.saveUser(user);

            return ResponseEntity.ok(new UserResponse("", user));
        } else {
            return ResponseEntity.badRequest().body(null);
        }

    }

    @GetMapping(value = "/number_of_registration")
    public ResponseEntity<Long> getRegistrationCount() {

        Long count = userService.getNumberOfRegisteredUsers();

        return ResponseEntity.ok(count);

    }

    @PostMapping(value = "/password-recovery")
    public ResponseEntity<?> passwordRecoveryEmail(@RequestParam String email) {

        User_ user = userService.findByUsernameOrEmail(email).orElse(null);

        if (user == null) {
            return ResponseEntity.badRequest().body("Oops, we couldn't find any user with the email provided");
        }

        ConfirmationToken confirmationToken = new ConfirmationToken(user);
        confirmationTokenService.save(confirmationToken);


        try {
            confirmationTokenService.sendConfirmationEmail(user.getEmail(), confirmationToken);
        } catch (IOException e) {
            e.printStackTrace();
        }


        return ResponseEntity.ok("Confirmation token sent");

    }

    @RequestMapping(value = "/update-password", method = {RequestMethod.POST})
    public ResponseEntity<?> updatePassword(@RequestParam("token") String confirmationToken, @RequestParam("password") String password) {

        ConfirmationToken token = confirmationTokenService.findByConfirmationToke(confirmationToken);

        if (token == null) {
            return ResponseEntity.badRequest().body("invalid token");
        }

        User_ user = token.getUser();
        user.setPassword(encoder.userPasswordEncoder().encode(password));
        userService.saveUser(user);

        return ResponseEntity.ok(new UserResponse("", user));


    }


    @RequestMapping(value = "/update/password", method = {RequestMethod.POST})
    public ResponseEntity<UserResponse> updatePassword(@RequestParam("username") String username,
                                                       @RequestParam("old_password") String oldPassword,
                                                       @RequestParam("password") String password) {


        User_ user = userService.findByUsername(username);
        user.setPassword(encoder.userPasswordEncoder().encode(password));
        userService.saveUser(user);
        String token = jwtTokenUtil.generateToken(user);
        return ResponseEntity.ok(new UserResponse(token, user));

    }

    @RequestMapping(value = "/userinfo", method = {RequestMethod.GET, RequestMethod.POST})
    public ResponseEntity<UserResponse> getUserInfo(Authentication authentication) {
        if (authentication != null) {
            User_ user = userService.findByUsernameOrEmail(authentication.getName()).orElse(null);
            UserResponse userResponse = new UserResponse(user);
            return ResponseEntity.ok(userResponse);
        } else {
            return ResponseEntity.badRequest().body(null);
        }
    }


    @RequestMapping(value = "/userinfobyid", method = {RequestMethod.GET, RequestMethod.POST})
    public ResponseEntity<UserResponse> getUserInfoById(@RequestParam String id, OAuth2Authentication authentication) {

        if (authentication.isClientOnly()) {
            OauthClientDetails clientDetails = oauthClientDetailsService.
                    findOauthClient((String) authentication.getPrincipal());
            if (clientDetails == null) {
                return ResponseEntity.badRequest().body(null);
            }
            User_ user = userService.findById(id);
            if (user == null) {
                return ResponseEntity.badRequest().body(null);
            }
            UserResponse userResponse = new UserResponse(user);
            return ResponseEntity.ok(userResponse);

        } else {
            return ResponseEntity.badRequest().body(null);
        }
    }


    @RequestMapping(value = "/userinfobyemail", method = {RequestMethod.GET, RequestMethod.POST})
    public ResponseEntity<UserResponse> getUserInfoByEmail(@RequestParam String email, OAuth2Authentication authentication) {

        if (authentication.isClientOnly()) {
            OauthClientDetails clientDetails = oauthClientDetailsService.
                    findOauthClient((String) authentication.getPrincipal());
            if (clientDetails == null) {
                return ResponseEntity.badRequest().body(null);
            }
            User_ user = userService.findByEmail(email);
            if (user == null) {
                return ResponseEntity.badRequest().body(null);
            }
            UserResponse userResponse = new UserResponse(user);
            return ResponseEntity.ok(userResponse);

        } else {
            return ResponseEntity.badRequest().body(null);
        }
    }

    @RequestMapping(value = "/shareduserinfobyemail", method = {RequestMethod.GET, RequestMethod.POST})
    public ResponseEntity<UserResponse> getSharedUserInfoByEmail(@RequestParam String sharedEmail, OAuth2Authentication authentication) {


            User_ user = userService.findByEmail(sharedEmail);
            if (user == null) {
                return ResponseEntity.badRequest().body(null);
            }
            UserResponse userResponse = new UserResponse(user);
            return ResponseEntity.ok(userResponse);


    }
    @PostMapping(value = "/userinfo/update")
    public ResponseEntity<UserResponse> updateUser(@RequestBody UserRequest userRequest) {

        User_ user = userService.checkUserByTokenId(userRequest.getToken());


        if (user != null) {
            boolean updatedUsername = false;
            if (!user.getUsername().equals(userRequest.getUsername())) updatedUsername = true;
            user.update(userRequest);

            User_Details user_details;
            if (user.getUserDetails() == null || user.getUserDetails().getId() == null) {
                user_details = new User_Details(userRequest);
            } else {
                user_details = user.getUserDetails();
                user_details.update(userRequest);
            }
            user_details.setUser(user);
            user_detailsService.save(user_details);


            if (updatedUsername) {
                userService.revokeTokenId(userRequest.getToken());
            }

            UserResponse userResponse = new UserResponse(user);
            return ResponseEntity.ok(userResponse);
        } else {
            return ResponseEntity.badRequest().body(null);
        }
    }

    private void authenticate(String username, String password) {
        authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(username, password));
    }

}
