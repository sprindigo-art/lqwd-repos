package com.lqwd.repository;

import com.lqwd.model.entity.CipherKeyUpdate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface CipherKeyUpdateRepository extends JpaRepository<CipherKeyUpdate, Long> {

}
