package com.lqwd.repository;

import com.lqwd.model.entities.LspStakingDays;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface LspStakingDaysRepository extends JpaRepository<LspStakingDays, Long> {

    @Query(value = "SELECT p FROM LspStakingDays p where p.days = :day")
    Optional<LspStakingDays> findByDays(@Param("day") int day);
}
