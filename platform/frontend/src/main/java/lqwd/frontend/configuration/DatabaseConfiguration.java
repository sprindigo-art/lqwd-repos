package lqwd.frontend.configuration;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.Environment;
import org.springframework.session.jdbc.config.annotation.SpringSessionDataSource;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import javax.sql.DataSource;

@Configuration
@EnableTransactionManagement
public class DatabaseConfiguration {

    @Autowired
    private Environment environment;

    @Bean
    @Primary
    @ConfigurationProperties("primary.datasource")
    public DataSourceProperties primaryDataSourceProperties(){
        return new DataSourceProperties();
    }

    @Bean
    @Primary
    public DataSource primaryDataSource(){
        return primaryDataSourceProperties().initializeDataSourceBuilder().type(HikariDataSource.class).build();
    }

    @Bean
    @ConfigurationProperties("session.datasource")
    public DataSourceProperties sessionDataSourceProperties(){
        return new DataSourceProperties();
    }

    @Bean
    @SpringSessionDataSource
    public DataSource springSessionDataSource(){
        return sessionDataSourceProperties().initializeDataSourceBuilder().type(HikariDataSource.class).build();
    }
}