package com.lqwd.repository;

import com.lqwd.model.entities.AllTransaction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;


@Repository
public interface AllTransactionRepository extends JpaRepository<AllTransaction, Long>, JpaSpecificationExecutor<AllTransaction> {



    @Transactional
    @Modifying
    @Query(value = "REFRESH MATERIALIZED VIEW all_transaction", nativeQuery = true)
    void refreshView();

}
