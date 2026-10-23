package com.lqwd.repository;

import com.lqwd.model.entities.Invoice;
import org.springframework.data.domain.Page;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface InvoiceRepository extends JpaRepository<Invoice, Long> {

   Optional<Invoice> findByHashStr(String rHash);
   Optional<Invoice> findByPaymentRequest(String paymentRequest);

}
