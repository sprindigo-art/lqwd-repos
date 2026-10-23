package com.lqwd.repository;

import com.lqwd.model.entities.LspForwardingHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface LspForwardingHistoryRepository extends JpaRepository<LspForwardingHistory, Long> {

}
