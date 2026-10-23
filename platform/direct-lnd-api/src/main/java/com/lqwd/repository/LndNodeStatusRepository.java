package com.lqwd.repository;

import com.lqwd.model.entities.LndNodeStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

@Repository
public interface LndNodeStatusRepository extends JpaRepository<LndNodeStatus, Long> {

    @Query(value = "SELECT * FROM lnd_node_status " +
            " WHERE id = (SELECT MAX(id) FROM lnd_node_status WHERE lnd_node_name = ?1)",
            nativeQuery = true)
    LndNodeStatus getStatus(String lndNodeName);
}
