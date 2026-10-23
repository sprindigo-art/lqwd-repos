package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.Invoice;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface InvoiceRepository extends JpaRepository<Invoice, Long> {

    Optional<Invoice> findByPaymentMethodId(String paymentMethodId);
    Page<Invoice> findByUserId(String userId, Pageable pageable);

    @Query(value = "SELECT * FROM invoice WHERE user_id = :userId AND to_char(date_created,'MM-YYYY') = :date LIMIT 1", nativeQuery = true)
    Optional<Invoice> invoiceForDateForUser (String userId, String date);
}
