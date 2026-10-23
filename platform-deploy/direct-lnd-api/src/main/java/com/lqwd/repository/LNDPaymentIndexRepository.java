package com.lqwd.repository;

import com.lqwd.model.entities.LndPaymentIndex;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface LNDPaymentIndexRepository extends JpaRepository<LndPaymentIndex, Long>  {
 Optional<LndPaymentIndex> findByNodeName(String nodeName);
}
