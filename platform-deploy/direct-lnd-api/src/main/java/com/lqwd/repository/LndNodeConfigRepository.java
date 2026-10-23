package com.lqwd.repository;

import com.lqwd.model.entities.LndNodeConfig;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

@Repository
public interface LndNodeConfigRepository extends JpaRepository<LndNodeConfig, Long> {

    @Query(value = "SELECT * FROM lnd_node_configs " +
            " WHERE id = (SELECT MAX(id) FROM lnd_node_status WHERE lnd_node_name = ?1)",
            nativeQuery = true)
    LndNodeConfig getLndNodeLastConfig(String lndNodeName);

    @Query(value = "SELECT * FROM lnd_node_configs " +
            " WHERE  lnd_node_name = ?1 and version = ?2",
            nativeQuery = true)
    LndNodeConfig getLndNodeConfigVersion(String lndNodeName, String version);

    @Query(value = "UPDATE lnd_node_configs SET config_param = ?1 WHERE id = ?2", nativeQuery = true)
    LndNodeConfig updateConfigParam(String configParam, int id);
}
