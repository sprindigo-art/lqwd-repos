package com.lqwd.repository;

import com.lqwd.model.entities.LndPayment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface LNDPaymentRepository extends JpaRepository<LndPayment, Long>  {
 Page<LndPayment> findByNodeName(String nodeName, Pageable pageable);
 long countByNodeName(String nodeName);
}
