package com.lqwd.repository;

import com.lqwd.model.entity.CipherMethod;
import com.lqwd.model.entity.CipherMethodUpdate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface CipherMethodUpdateRepository extends JpaRepository<CipherMethodUpdate, Long> {


}
