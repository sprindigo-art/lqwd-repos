package com.lqwd.repository;

import com.lqwd.model.entity.CipherMethodUpdate;
import com.lqwd.model.entity.SecretKeyChangeLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface SecretKeyChangeLogRepository extends JpaRepository<SecretKeyChangeLog, Long> {

}
