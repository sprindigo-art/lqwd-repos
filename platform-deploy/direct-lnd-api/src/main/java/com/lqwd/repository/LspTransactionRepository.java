package com.lqwd.repository;

import com.lqwd.model.entities.LndAddress;
import com.lqwd.model.entities.LspStakingDays;
import com.lqwd.model.entities.LspTransaction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;


@Repository
public interface LspTransactionRepository extends JpaRepository<LspTransaction, Long> {

    @Query(value = "SELECT p FROM LspTransaction p where p.transactionHash = :transactionHash")
    Optional<LspTransaction> findByTransactionHash(@Param("transactionHash") String transactionHash);
}
