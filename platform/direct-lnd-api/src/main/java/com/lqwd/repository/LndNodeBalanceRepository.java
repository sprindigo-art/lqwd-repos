package com.lqwd.repository;

import com.lqwd.model.entities.LndNodeBalance;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Date;
import java.util.List;


@Repository
public interface LndNodeBalanceRepository extends JpaRepository<LndNodeBalance, Long> {
    long deleteAllByNodeName(String nodeName);
    LndNodeBalance findFirstByNodeNameOrderByDateCreatedDesc(String nodeName);
    List<LndNodeBalance> findByUserId(String userId);

    @Query(value = "SELECT t1.* FROM lnd_node_balance t1 " +
            "JOIN ( SELECT DATE(date_created) date_date, node_name, MAX(date_created) max_date " +
            "FROM lnd_node_balance GROUP BY date_date, node_name) t2 " +
            "ON t1.date_created = t2.max_date AND t1.node_name = t2.node_name" +
            " WHERE user_id = ?3 AND date_created >= ?1 AND date_created <= ?2",
            nativeQuery = true)
    List<LndNodeBalance> findAllByStartDateAndEndDate(Date start, Date end, String userId);

    @Query(value = "SELECT t1.* FROM lnd_node_balance t1 " +
            "JOIN (SELECT node_name, MAX(date_created) max_date " +
            "FROM lnd_node_balance " +
            "GROUP BY node_name ) t2 " +
            "ON t1.date_created = t2.max_date AND t1.node_name = t2.node_name WHERE user_id = ?1",
    nativeQuery = true)
    List<LndNodeBalance> findAllLatestBalancesForUser(String userId);
}
