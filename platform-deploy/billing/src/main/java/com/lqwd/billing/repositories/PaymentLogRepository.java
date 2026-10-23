package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.PaymentLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PaymentLogRepository extends JpaRepository<PaymentLog, Long> {

    Optional<PaymentLog> findByIdentifier(String identifier);

}
