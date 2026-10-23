package com.lqwd.repository;

import com.lqwd.model.entities.LndTransactionOutputDetail;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface LspTransactionAddressRepository extends JpaRepository<LndTransactionOutputDetail, Long> {

}
