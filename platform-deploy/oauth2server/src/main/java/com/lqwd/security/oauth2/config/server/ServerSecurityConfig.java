package com.lqwd.security.oauth2.config.server;

import com.lqwd.security.oauth2.config.encryption.Encoders;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.authentication.builders.AuthenticationManagerBuilder;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.builders.WebSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

import javax.sql.DataSource;
import java.util.Arrays;


@Configuration
@EnableWebSecurity
@Import({Encoders.class, ConfigQueries.class})
public class ServerSecurityConfig extends WebSecurityConfigurerAdapter {


    @Autowired
    private Encoders encoders;

    @Autowired
    private ConfigQueries configQueries;


    @Autowired
    private DataSource dataSource;

    @Autowired
    private  CustomAuthenticationProvider customAuthenticationProvider;



    @Override
    protected void configure(AuthenticationManagerBuilder auth)
            throws Exception {

        auth.
                jdbcAuthentication()
                .usersByUsernameQuery(configQueries.getUsersQueryUsername())
                .authoritiesByUsernameQuery(configQueries. getRolesQueryUser())
                .dataSource(dataSource)
                .passwordEncoder(encoders.oauthClientPasswordEncoder());

        auth.
                jdbcAuthentication()
                .usersByUsernameQuery(configQueries.getUsersQueryEmail())
                .authoritiesByUsernameQuery(configQueries.getRolesQueryEmail())
                .dataSource(dataSource)
                .passwordEncoder(encoders.oauthClientPasswordEncoder());



    }

    private ProviderManager createPreAuthProvider() {
        return new ProviderManager(Arrays.asList(getDaoAuthenticationProvider()));
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {

        http.
                authorizeRequests()
                .antMatchers("/").permitAll()
                .antMatchers("/lndnodeinfo").authenticated()
                .antMatchers("/apikey/authorize").permitAll()
                .antMatchers("/authorize/check_credentials").permitAll()
                .antMatchers("/login/**").permitAll()
                .antMatchers("/registration").permitAll()
                .antMatchers("/backend/**").hasAuthority("ADMIN").anyRequest()
                .authenticated().and().csrf().disable().formLogin()
                .loginPage("/login").failureUrl("/login?error=true")
                .defaultSuccessUrl("/backend/accounttypes")
                .usernameParameter("email")
                .passwordParameter("password")
                .and().logout()
                .logoutRequestMatcher(new AntPathRequestMatcher("/logout"))
                .logoutSuccessUrl("/").and().exceptionHandling()
                .accessDeniedPage("/access-denied");
    }

    @Override
    public void configure(WebSecurity web) {
        web
                .ignoring()
                .antMatchers("/resources/**", "/static/**", "/css/**", "/js/**", "/images/**");
    }


    @Override
    @Bean
    public AuthenticationManager authenticationManagerBean() {
        return createPreAuthProvider();
    }



    public DaoAuthenticationProvider getDaoAuthenticationProvider() {
        customAuthenticationProvider.setPasswordEncoder(encoders.oauthClientPasswordEncoder());
        return customAuthenticationProvider;
    }
}
