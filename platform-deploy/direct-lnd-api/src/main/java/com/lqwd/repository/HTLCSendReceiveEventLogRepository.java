package com.lqwd.repository;

import com.lqwd.model.entities.HTLCSendReceiveEventLog;
import com.lqwd.model.entities.LspForwardingHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Date;
import java.util.List;


@Repository
public interface HTLCSendReceiveEventLogRepository extends JpaRepository<HTLCSendReceiveEventLog, Long> {

    @Query("select h from HTLCSendReceiveEventLog h where h.dateCreated >= :start and h.dateCreated <= :end and h.userId = :userId")
    List<HTLCSendReceiveEventLog> findAllByStartDateAndEndDate(Date start, Date end, String userId);

}
