package com.lqwd.repository;

import com.lqwd.model.entities.LspMonitorState;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface LspMonitorStateRepository extends JpaRepository<LspMonitorState, Long> {

}
