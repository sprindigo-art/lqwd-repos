package com.lqwd.service;

import com.lqwd.config.AppProperties;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;

@Service
@RequiredArgsConstructor
public class LNDDatabaseHandler {

    final String deleteQuery = "DROP database \"%s\" WITH (FORCE)";

    private final AppProperties appProperties;


    private Logger logger = LoggerFactory.getLogger(LNDDatabaseHandler.class);

    private Connection connect(){

        try {
           return DriverManager.getConnection(appProperties.getLnd_database_url(),
                   appProperties.getLnd_database_username(), appProperties.getLnd_database_password());
        } catch (SQLException e) {
            e.printStackTrace();
            logger.info("Failed to acquire connection to LND database");
        }

        return null;
    }

    public void deleteLNDDatabase(String dbName) {
        logger.info("Deleting LND database {}", dbName);

        Connection connection = connect();

        if(connection == null)
            return;

        try {
            PreparedStatement ps = connection.prepareStatement(String.format(deleteQuery,dbName));
            ps.execute();
        } catch (SQLException e) {
            logger.info("Could not delete the specified db: {}",e.getMessage());
        }


    }

}
