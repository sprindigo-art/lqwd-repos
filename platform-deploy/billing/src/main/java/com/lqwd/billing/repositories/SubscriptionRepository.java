package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.Subscription;
import com.lqwd.billing.enums.SubscriptionStatus;
import com.lqwd.billing.models.ProductResponse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SubscriptionRepository extends JpaRepository<Subscription, Long> {
    List<Subscription> findByUserId(String userId);

    List<Subscription> findByStatus(SubscriptionStatus status);

    Optional<Subscription> findByNodeId(String nodeId);

    @Query("SELECT new com.lqwd.billing.models.ProductResponse(p, s) FROM  Product p, SubscriptionPlan s WHERE s.productId = p.productId")
    List<ProductResponse> findProducts();

}
