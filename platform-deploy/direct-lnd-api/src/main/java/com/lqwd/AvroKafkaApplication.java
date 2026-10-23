package com.lqwd;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

import javax.sql.DataSource;


@SpringBootApplication
@EnableScheduling()
@EnableAsync
@EnableSchedulerLock(defaultLockAtMostFor = "PT30S")
public class AvroKafkaApplication {


    public static void main(String[] args) {
        SpringApplication.run(AvroKafkaApplication.class, args);
    }


    @Bean
    public LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(dataSource);
    }

   

}
