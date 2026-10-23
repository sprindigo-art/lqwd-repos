package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.SubscriptionPlan;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlanRepository extends JpaRepository<SubscriptionPlan, Long> {
}
