package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.Product;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductRepository extends JpaRepository<Product, Long> {
}
