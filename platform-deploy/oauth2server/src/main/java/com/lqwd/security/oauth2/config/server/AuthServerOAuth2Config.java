package com.lqwd.security.oauth2.config.server;


import com.lqwd.security.oauth2.model.security.ApiKey;
import com.lqwd.security.oauth2.service.ApiKeyService;
import com.lqwd.security.oauth2.service.RoleService;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.method.configuration.EnableGlobalMethodSecurity;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.common.DefaultOAuth2AccessToken;
import org.springframework.security.oauth2.common.OAuth2AccessToken;
import org.springframework.security.oauth2.common.exceptions.InvalidTokenException;
import org.springframework.security.oauth2.config.annotation.configurers.ClientDetailsServiceConfigurer;
import org.springframework.security.oauth2.config.annotation.web.configuration.AuthorizationServerConfigurerAdapter;
import org.springframework.security.oauth2.config.annotation.web.configuration.EnableAuthorizationServer;
import org.springframework.security.oauth2.config.annotation.web.configurers.AuthorizationServerEndpointsConfigurer;
import org.springframework.security.oauth2.config.annotation.web.configurers.AuthorizationServerSecurityConfigurer;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.security.oauth2.provider.OAuth2Request;
import org.springframework.security.oauth2.provider.error.OAuth2AccessDeniedHandler;
import org.springframework.security.oauth2.provider.token.DefaultTokenServices;
import org.springframework.security.oauth2.provider.token.TokenEnhancer;
import org.springframework.security.oauth2.provider.token.TokenEnhancerChain;
import org.springframework.security.oauth2.provider.token.TokenStore;
import org.springframework.security.oauth2.provider.token.store.JdbcTokenStore;

import javax.sql.DataSource;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Configuration
@EnableAuthorizationServer
@EnableGlobalMethodSecurity(prePostEnabled = true)
@Import(ServerSecurityConfig.class)
public class AuthServerOAuth2Config extends AuthorizationServerConfigurerAdapter {

    @Autowired
    @Qualifier("dataSource")
    private DataSource dataSource;

    @Autowired
    private AuthenticationManager authenticationManager;

    @Qualifier("jwtUserDetailsService")
    @Autowired
    private UserDetailsService userDetailsService;

    @Autowired
    private PasswordEncoder oauthClientPasswordEncoder;


    @Autowired
    ApiKeyService apiKeyService;

    @Autowired
    RoleService roleService;



//

    @Bean
    public TokenStore tokenStore() {
        final Log LOG = LogFactory.getLog(JdbcTokenStore.class);
        return new JdbcTokenStore(dataSource) {

            /***
             * If token is api key load authentication via api key else load authentication
             * using default jdbc implementation from db
             * @param token
             * @return
             */
            @Override
            public OAuth2Authentication readAuthentication(OAuth2AccessToken token) {
                System.out.println("loading authentication via store now");
                if(!isBearerTokenString(token.getValue())){
                    return loadAuthenticationFromApiKey(token.getValue());
                }else{
                    return super.readAuthentication(token);
                }
            }

            /**
             * If token is api key load custom inmemmory ouath2access token else load
             * using default jdbc implementation from db
             * @param tokenValue
             * @return
             */
        	@Override
        	public OAuth2AccessToken readAccessToken(String tokenValue) {
                if(!isBearerTokenString(tokenValue)){
                    ApiKey apiKey = apiKeyService.checkApikey(tokenValue);
                    if(apiKey != null){
                        return new DefaultOAuth2AccessToken(tokenValue);
                    }else{
                        LOG.info("Invalid api key from store" + tokenValue);
                        return null;
                    }
                }else{
                    return super.readAccessToken(tokenValue);
                }
        	}

        };
    }


    @Bean
    public OAuth2AccessDeniedHandler oauthAccessDeniedHandler() {
        return new OAuth2AccessDeniedHandler();
    }

    @Override
    public void configure(AuthorizationServerSecurityConfigurer oauthServer) {
        oauthServer.tokenKeyAccess("permitAll()")

                .checkTokenAccess("isAuthenticated()")
                .passwordEncoder(oauthClientPasswordEncoder);
    }

    @Override
    public void configure(ClientDetailsServiceConfigurer clients) throws Exception {
        clients.jdbc(dataSource);
    }

    @Override
    public void configure(AuthorizationServerEndpointsConfigurer endpoints) {
        final TokenEnhancerChain tokenEnhancerChain = new TokenEnhancerChain();
        tokenEnhancerChain.setTokenEnhancers(Arrays.asList(tokenEnhancer()));
        endpoints
                .tokenStore(tokenStore())
                .tokenEnhancer(tokenEnhancerChain) //sets token enhancer used to update token with additional information.
                .tokenServices(createTokenServices(endpoints))
                .authenticationManager(authenticationManager)
                .userDetailsService(userDetailsService);

    }

    /**
     * checks if token in Authorization header
     * @param accessTokenValue
     * @return
     */
    private boolean isBearerTokenString(String accessTokenValue){
        //is jdbc token
        String[] sarray = accessTokenValue.split("-");
        if (sarray.length == 5) {
            return sarray[1].length() == 4 && sarray[2].length() == 4;
        }
        return false;
    }

    /**
     * Custom token service
     * @param endpoints
     * @return
     */
    private DefaultTokenServices createTokenServices(AuthorizationServerEndpointsConfigurer endpoints) {
        DefaultTokenServices tokenServices = new DefaultTokenServices(){

            /**
             * if token is api key  load authentication using custom implementation via api key
             * else default to token services implementation which in turn uses jdbcstore
             * to load authentication from db
             * @param accessTokenValue
             * @return
             * @throws AuthenticationException
             * @throws InvalidTokenException
             */
            @Override
            public OAuth2Authentication loadAuthentication(String accessTokenValue) throws AuthenticationException, InvalidTokenException {
               if(!isBearerTokenString(accessTokenValue)){
                   OAuth2Authentication oAuth2Authentication = loadAuthenticationFromApiKey(accessTokenValue);
                   if(oAuth2Authentication != null){
                       return oAuth2Authentication;
                   }
                    throw new InvalidTokenException("Invalid api key: " + accessTokenValue);
                }else{
                    return super.loadAuthentication(accessTokenValue);
                }

            }
        };

        tokenServices.setSupportRefreshToken(true);
        tokenServices.setTokenStore(endpoints.getTokenStore());
        tokenServices.setClientDetailsService(endpoints.getClientDetailsService());
        tokenServices.setTokenEnhancer(endpoints.getTokenEnhancer());
        return tokenServices;
    }


    private OAuth2Authentication loadAuthenticationFromApiKey(String apiKeyString){
        ApiKey apiKey = apiKeyService.checkApikey(apiKeyString);
        if(apiKey != null){
            Map<String, String> requestParameters = new HashMap<>();
            List<GrantedAuthority> authorityList =  roleService.listByUser(apiKey.getUser().getId()).stream().map((String i) ->new SimpleGrantedAuthority(i)).collect(Collectors.toList());
            ApikeyAuthentication authentication = new ApikeyAuthentication(new User(apiKey.getUser().getEmail(), "", authorityList), authorityList);
            return new OAuth2Authentication(new OAuth2Request(requestParameters, null, authorityList, true, null,
                    null, null, null, null), authentication);
        }
        return null;
    }



    @Bean
    public TokenEnhancer tokenEnhancer() {
        return new Oauth2TokenEnhancer();
    }


}
