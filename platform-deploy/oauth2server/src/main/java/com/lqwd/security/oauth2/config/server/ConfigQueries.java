package com.lqwd.security.oauth2.config.server;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Configuration;

/**
 * <p>
 * Essence of this class is to fix the issue with having @RefreshScope and @EnableWebSecurity annotations
 * at the same time on WebsecurityConfigurers in this case {@link ServerSecurityConfig}.
 * </p>
 *
 * <p>
 * The {@link ServerSecurityConfig} initially had the variables in this class,  so whenever config values are refreshed,
 * an {@link IllegalMonitorStateException} is thrown. This is because multiple
 * WebsecurityConfigurer beans are created, since we have both @EnableWebSecurity annotation in {@link ServerSecurityConfig} and @EnableGlobalMethodSecurity(prePostEnabled = true)
 * annotation in {@link AuthServerOAuth2Config}.
 * </p>
 *
 * <p>
 * By having the  @RefreshScope on this bean rather than on {@link ServerSecurityConfig} fixes that error.
 * </p>
 */
@RefreshScope
@Configuration
public class ConfigQueries {

    @Value("${spring.queries.users-query}")
    private String usersQueryUsername;

    @Value("${spring.queries.email-query}")
    private String usersQueryEmail;

    @Value("${spring.queries.roles-query-user}")
    private String rolesQueryUser;

    @Value("${spring.queries.roles-query-email}")
    private String rolesQueryEmail;


    public String getUsersQueryUsername() {
        return usersQueryUsername;
    }

    public String getUsersQueryEmail() {
        return usersQueryEmail;
    }

    public String getRolesQueryUser() {
        return rolesQueryUser;
    }

    public String getRolesQueryEmail() {
        return rolesQueryEmail;
    }
}
