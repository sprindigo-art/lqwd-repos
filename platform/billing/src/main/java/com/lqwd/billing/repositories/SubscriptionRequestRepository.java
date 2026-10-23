package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.SubscriptionRequest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SubscriptionRequestRepository extends JpaRepository<SubscriptionRequest, Long> {
    Optional<SubscriptionRequest> findByLndInvoiceId(String lndInvoiceId);
    Optional<SubscriptionRequest> findByNode(String node);

}
