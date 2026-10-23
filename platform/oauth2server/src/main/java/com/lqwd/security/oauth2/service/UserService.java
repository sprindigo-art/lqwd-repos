package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.config.encryption.Encoders;
import com.lqwd.security.oauth2.config.utils.ApplicationUtils;
import com.lqwd.security.oauth2.config.utils.AsymmetricCryptography;
import com.lqwd.security.oauth2.dto.UserDTO;
import com.lqwd.security.oauth2.model.response.ErrorResponse;
import com.lqwd.security.oauth2.model.security.AccountInfo;
import com.lqwd.security.oauth2.model.security.AccountType;
import com.lqwd.security.oauth2.model.security.ApiKey;
import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.model.security.User_Details;
import com.lqwd.security.oauth2.repository.AccountInfoRepository;
import com.lqwd.security.oauth2.repository.AccountTypeRepository;
import com.lqwd.security.oauth2.repository.ApiKeyRepository;
import com.lqwd.security.oauth2.repository.RoleRepository;
import com.lqwd.security.oauth2.repository.UserRepository;
import com.lqwd.security.oauth2.repository.User_DetailsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.oauth2.common.OAuth2AccessToken;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.security.oauth2.provider.token.DefaultTokenServices;
import org.springframework.security.oauth2.provider.token.TokenStore;
import org.springframework.security.oauth2.provider.token.store.JdbcTokenStore;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.BadPaddingException;
import javax.crypto.IllegalBlockSizeException;
import javax.sql.DataSource;
import java.io.UnsupportedEncodingException;
import java.security.InvalidKeyException;
import java.sql.Timestamp;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Service
@RequiredArgsConstructor
public class UserService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private User_DetailsRepository userDetailsRepository;


    @Autowired
    RoleRepository roleRepository;

    @Autowired
    private ApiKeyRepository apiKeyRepository;


    @Autowired
    private AccountTypeRepository accountTypeRepository;

//    @Autowired
//    private TokenStore tokenStore;

    @Autowired
    private AccountInfoRepository accountInfoRepository;

    @Autowired
    private AsymmetricCryptography asymmetricCryptography;

    @Value("${jwt.secret}")
    private String prKey;

    @Autowired
    private DataSource dataSource;



    @Autowired
    private Encoders encoder;

    public void revokeTokenId(String token){

        TokenStore tokenStore = new JdbcTokenStore(dataSource);
        DefaultTokenServices defaultTokenServices = new DefaultTokenServices();
        defaultTokenServices.setTokenStore(tokenStore);
        defaultTokenServices.setSupportRefreshToken(true);
        defaultTokenServices.revokeToken(token);

    }

    public User_ checkUserByTokenId(OAuth2Authentication authentication){

        User principal = (User) authentication.getPrincipal();
        return findByUsernameOrEmail(principal.getUsername()).orElse(
                null
        );

    }

    public User_ checkUserByTokenId(String token){

        TokenStore tokenStore = new JdbcTokenStore(dataSource);
        DefaultTokenServices defaultTokenServices = new DefaultTokenServices();
        defaultTokenServices.setTokenStore(tokenStore);
        defaultTokenServices.setSupportRefreshToken(true);
        OAuth2Authentication oAuth2Authentication = tokenStore.readAuthentication(token);
        User_ user = null;
        try {
            User principal = (User) oAuth2Authentication.getPrincipal();
            user = findByUsername(principal.getUsername());
            if(user == null) {
                user = findByEmail(principal.getUsername());
            }
        } catch (NullPointerException e){
            System.out.println(e.getMessage());
        }

        return user;
    }


    @Transactional(readOnly = true)
    public User_ findByUsername(String username){
        Optional<User_> user = userRepository.findByUsername(username);
        if (user.isPresent()) {
            return user.get();
        }
            return null;
    }


    public Optional<User_> findByUsernameOrEmail(String usernameOrEmail){
        return userRepository.findByUsernameOrEmail(usernameOrEmail, usernameOrEmail.toLowerCase());
    }

    public Long getNumberOfRegisteredUsers(){
        return userRepository.count();
    }

    public Optional<User_> findByUsernameOrEmail(String username, String email){
        return userRepository.findByUsernameOrEmail(username, email);
    }


    @Transactional(readOnly = true)
    public User_ findByEmail(String email){
        Optional<User_> user = userRepository.findByEmail(email);
        if (user.isPresent()) {
            return user.get();
        }
        return null;
    }

    public User_ findByUsernameOrNull(String username){
        Optional<User_> user = userRepository.findByUsername(username);
        if (user.isPresent()) {
            return user.get();
        }
        return null;
    }

    public User_ updateUserStatus(User_ user){
        return userRepository.save(user);
    }

    public User_ saveUser(User_ user){
        //should not be checking user roles here. this should just save user
        User_ saveduser = userRepository.save(user);
        if (saveduser != null) {
            return saveduser;
        }
        throw new  UsernameNotFoundException("User already exist : "+ user.getUsername());
    }


    public ErrorResponse saveUser(UserDTO userDTO){

    	User_ user_;
    	AccountInfo accountInfo;
    	AccountType accountType = accountTypeRepository.findById(userDTO.getAccountTypeId()).get();

    	User_Details userDetails;

    	if(userDTO.getId() == null || userDTO.getId().toString().trim().isEmpty()) {
    	    //check user already exist
    	    if(userRepository.findByUsername(userDTO.getUsername()).isPresent()){
                return ErrorResponse.builder().error(true).message("User With that username exist").build();
            }else if(userRepository.findByEmail(userDTO.getEmail()).isPresent()){
                return ErrorResponse.builder().error(true).message("User with that email exist").build();
            }
    		user_ = new User_();
    		accountInfo = new AccountInfo("free", "active");
    		userDetails = new User_Details();

    	}else {
            if(userRepository.findByUsernameAndNotId(userDTO.getUsername(), UUID.fromString(userDTO.getId())).isPresent()){
                return ErrorResponse.builder().error(true).message("User With that username exist").build();
            }else if(userRepository.findByEmailAndNotId(userDTO.getEmail(), UUID.fromString(userDTO.getId())).isPresent()){
                return ErrorResponse.builder().error(true).message("User with that email exist").build();
            }
    		user_ = findById(userDTO.getId());
    		accountInfo = user_.getAccountInfo();
    		userDetails = user_.getUserDetails();

    		if(accountInfo == null) {
    			accountInfo = new AccountInfo("free", "active");
    		}

    		if(userDetails == null) {
    			userDetails = new User_Details();
    		}
    	}


    	user_.setAccountExpired(userDTO.getAccountExpired());
    	user_.setAccountLocked(userDTO.getAccountLocked());
    	user_.setCredentialsExpired(userDTO.getCredentialsExpired());
    	user_.setEmail(userDTO.getEmail());
    	user_.setUsername(userDTO.getUsername());
    	user_.setEnabled(userDTO.getEnabled());
    	user_.setStatus(userDTO.getStatus());
    	user_.setAllowedNoOfLnd(userDTO.getAllowedNoOfLnd());

        Timestamp timestamp = new Timestamp(System.currentTimeMillis());
        user_.setCreatedDate(timestamp);

    	//setting user password here
    	if(userDTO.getId() == null || userDTO.getId().toString().trim().isEmpty()){
            user_.setPassword(encoder.userPasswordEncoder().encode(userDTO.getPassword()));
        }

        //getting list of selected role Ids
        List<UUID> roleIds = userDTO.getRoleIds().stream().map((id)->UUID.fromString(id)).collect(Collectors.toList());
        List<Role_> role_s = roleRepository.findByIds(roleIds);
        //clear saved access tokens if user_roles has change
        if(userDTO.getId() != null && !userDTO.getId().toString().trim().isEmpty()) {

            List<Object[]> existingRoleIds = userRepository.getUserRolesByUserId(UUID.fromString(userDTO.getId()));

            long diff = existingRoleIds.stream().filter((role_)->( !userDTO.getRoleIds().contains((String) role_[0]))).count();

            //user roles updated so we need to clear all access tokens.
            //this should force a logged in user to logout and then login to get
            //new user roles
            if(diff  > 0 || existingRoleIds.size() != roleIds.size()){

                final String user_name = user_.getUsername();
                existingRoleIds.forEach((Object) ->{
                    String client_id = (String)Object[1];
//                    Collection<OAuth2AccessToken> tokens = tokenStore.findTokensByClientIdAndUserName(client_id, user_name);
//
//                    tokens.forEach((token) ->{
//                        //remove access token per client id for user.
//                        tokenStore.removeAccessToken(token);
//                    });
                });

                //setting new set of roles

                //Remove staking role from role list if user email is not @lqwd.money
                if(!user_.getEmail().endsWith("@lqwd.money")){
                    role_s = role_s.stream().filter((role_)->!role_.getName().equals(ApplicationUtils.STAKING_ROLE)).collect(Collectors.toList());
                }

                user_.setRole_s(role_s);

                timestamp = new Timestamp(System.currentTimeMillis());
                user_.setCreatedDate(timestamp);

                user_ = userRepository.save(user_);
            }
        }





        accountInfo.setAccountType(accountType);
        accountInfo.setUser(user_);
        accountInfo = accountInfoRepository.save(accountInfo);

        userDetails.setFirstName(userDTO.getFirstName());
        userDetails.setFa2(userDTO.getFa2() == null?false:userDTO.getFa2());
        userDetails.setLastName(userDTO.getLastName());
        userDetails.setPhone(userDTO.getPhone());
        userDetails.setReceiveNews(userDTO.getReceiveNews() == null? false:userDTO.getReceiveNews());
        userDetails.setUser(user_);
        userDetails = userDetailsRepository.save(userDetails);

        //if user has liquidity role then set liquidity fee
        if(role_s.stream().filter(item->item.getName().equals(ApplicationUtils.LIQUIDITY_ROLE)).count() > 0){
            user_.setLiquidityFee(userDTO.getLiquidityFee());
        }

        user_.setAccountInfo(accountInfo);
        user_.setUserDetails(userDetails);

        timestamp = new Timestamp(System.currentTimeMillis());
        user_.setCreatedDate(timestamp);

        user_ = userRepository.save(user_);

    	return null;
    }

    public HashMap<String, Object> getAllWithLndNodeAndApiKeyCount(int currentPage, int amount, String query){
        HashMap<String, Object> result = new HashMap<String, Object>();
        Pageable pageable = PageRequest.of(currentPage, amount);
         Page<Object[]> items  = null;
        if(query != null){
            items  = userRepository.getAllWithLndNodeAndApiKeyCountByQuery("%"+query+"%", pageable);
        }else{
             items  = userRepository.getAllWithLndNodeAndApiKeyCount(pageable);
        }

        List<Integer> pageNumbers = IntStream.rangeClosed(1, items.getTotalPages())
                .boxed()
                .collect(Collectors.toList());
        result.put("pageNumbers", pageNumbers);
        result.put("currentPageNumber", items.getNumber());

        List<UserDTO> dtos = items.stream().map((object) -> {
            Timestamp lastAccess = (Timestamp)object[11];
            String lastAccessTime = "";
            if(lastAccess != null){
                lastAccessTime = lastAccess.toString();
            }

            Timestamp createdAt = (Timestamp)object[3];
            String createdAtTime = "";
            if(createdAt != null){
                createdAtTime = createdAt.toString();
            }

            Timestamp updatedAt = (Timestamp)object[4];
            String updatedAtTime = "";
            if(updatedAt != null){
                updatedAtTime = updatedAt.toString();
            }
            return UserDTO.builder()
                    .id((String)object[0])
                    .firstName((String)object[1])
                    .lastName((String)object[2])
                    .createdAt(createdAtTime)
                    .updatedAt(updatedAtTime)
                    .email((String)object[5])
                    .noOfLndNodes(((java.math.BigInteger)object[6]).intValue())
                    .noOfApiKeys(((java.math.BigInteger)object[7]).intValue())
                    .accountTypeName((String)object[8])
                    .accountExpired((boolean)object[9])
                    .status((String)object[10])
                    .username((String)object[12])
                    .lastAccess(lastAccessTime)
                    .build();
        }).collect(Collectors.toList());
        result.put("items", dtos);
        return result;
    }

    public Page<User_> getAll(int currentPage, int amount) {
        Pageable pageable = PageRequest.of(currentPage, amount);
        return userRepository.findAll(pageable);
    }

    public User_ findById(String id) {
        Optional<User_> user_ = userRepository.findById(java.util.UUID.fromString(id));
        if(user_.isPresent()){
            return user_.get();
        }
        return  null;
    }

    public String generateApikey(User_ user) throws  BadPaddingException,  IllegalBlockSizeException, UnsupportedEncodingException, InvalidKeyException {

        ApiKey apiKey = new ApiKey(user);
        apiKey.setStatus("generating");
        apiKey.setCreated(new Date());
        apiKey = apiKeyRepository.save(apiKey);

        String stringApiKey = asymmetricCryptography.encryptText("#"+apiKey.getId().toString(), prKey);
        apiKey.setStatus("active");
        apiKey.setApikey(stringApiKey);
        apiKeyRepository.save(apiKey);
        return stringApiKey;
    }

    public User_ findByApiKey(String stringApikey) {
        Optional<ApiKey> apiKey = apiKeyRepository.findByApiKey(stringApikey);
        if(apiKey.isPresent()) {
            return apiKey.get().getUser();
        } else return null;

    }

    public User_ findByTokenOld(String token){
        Optional<User_> user = userRepository.findByToken(token);
        if(user.isPresent()){
            return  user.get();

        } else {
            return  null;
        }
    }

    public void removeToken(String username) {
        userRepository.deleteToken(username);
    }


    public List<User_> findAllByStatus(String status){
        return userRepository.findAllByStatus(status);
    }


    private User_ toModel(UserDTO userDTO, User_ user) {
    	if ( userDTO == null ) {
            return null;
        }

        user.setUsername( userDTO.getUsername() );
        user.setEmail( userDTO.getEmail() );
        user.setPassword( userDTO.getPassword() );
        if ( userDTO.getAccountExpired() != null ) {
            user.setAccountExpired( userDTO.getAccountExpired() );
        }
        if ( userDTO.getAccountLocked() != null ) {
            user.setAccountLocked( userDTO.getAccountLocked() );
        }
        if ( userDTO.getCredentialsExpired() != null ) {
            user.setCredentialsExpired( userDTO.getCredentialsExpired() );
        }
        if ( userDTO.getEnabled() != null ) {
            user.setEnabled( userDTO.getEnabled() );
        }

        return user;
    }

}
