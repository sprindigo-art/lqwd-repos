package com.lqwd;

import com.lqwd.security.CustomAuthenticationProvider;

//import com.lqwd.security.JWTAuthorizationFilter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.authentication.builders.AuthenticationManagerBuilder;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.builders.WebSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

@EnableWebSecurity
@Configuration
public class WebSecurityConfig extends WebSecurityConfigurerAdapter {

//    @Autowired
//    private JWTAuthorizationFilter jwtAuthorizationFilter;

//    @Autowired
//    private CustomAuthenticationProvider authProvider;

    @Override
    protected void configure(HttpSecurity http) throws Exception {

//        http
//                .authorizeRequests()
//                .anyRequest().authenticated()
//                .and().csrf().disable().formLogin()
//                .loginPage("/login/token").permitAll();



        http.
                authorizeRequests()
                .antMatchers("/login/**").permitAll()
                .antMatchers("/setting/**").permitAll()
                .antMatchers("/account/**").permitAll()
                .antMatchers("/lndnode/**").permitAll()
                .antMatchers("/kubernetes/**").permitAll()
                //.antMatchers("login/registration").permitAll()
                .and().authenticationProvider(authProvider)
                .csrf().disable();





//
//        http.csrf()
//                .disable()
//                .addFilterAfter(this.jwtAuthorizationFilter, UsernamePasswordAuthenticationFilter.class)
//                .authorizeRequests()
//                .anyRequest()
//                .authenticated();
    }




//
    @Autowired
    private CustomAuthenticationProvider authProvider;

//    @Override
//    protected void configure(AuthenticationManagerBuilder auth) throws Exception {
//        auth.authenticationProvider(authProvider);
////        auth.inMemoryAuthentication()
////                .withUser("User1@gmail.com")
////                .password(passwordEncoder().encode("User1"))
////                .roles("ADMIN");
//    }

//    @Override
//    protected void configure(HttpSecurity http) throws Exception {
//
////        http
////                .authorizeRequests()
////                .anyRequest().authenticated()
////                .and().csrf().disable().formLogin()
////                .loginPage("/login").permitAll();
//
//        http.
//                authorizeRequests()
//                .antMatchers("/").permitAll()
//                .antMatchers("/lnd").permitAll()
//                .antMatchers("/registration").permitAll()
//                .antMatchers("/homepage").permitAll()
//                .and().authenticationProvider(authProvider)
//                .csrf().disable().formLogin()
//                .loginPage("/login").failureUrl("/login?error=true")
//                .defaultSuccessUrl("/homepage")
//                .usernameParameter("email")
//                .passwordParameter("password")
//                .and().logout()
//                .logoutRequestMatcher(new AntPathRequestMatcher("/logout"))
//                .logoutSuccessUrl("/").and().exceptionHandling()
//                .accessDeniedPage("/access-denied");
//    }
//
//    @Override
//    public void configure(WebSecurity web) throws Exception {
//        web
//                .ignoring()
//                .antMatchers("/resources/**", "/static/**", "/css/**", "/js/**", "/images/**");
//    }
//
//    @Bean
//    public PasswordEncoder passwordEncoder() {
//        return new BCryptPasswordEncoder();
//    }

}
