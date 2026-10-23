package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.Discount;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DiscountRepository extends JpaRepository<Discount, Long> {
}
