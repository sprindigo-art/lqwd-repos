package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.LndInvoice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface LndInvoiceRepository extends JpaRepository<LndInvoice, Long> {

   Optional<LndInvoice> findByHashStr(String rHash);
   Optional<LndInvoice> findByUniqueID(String id);

}