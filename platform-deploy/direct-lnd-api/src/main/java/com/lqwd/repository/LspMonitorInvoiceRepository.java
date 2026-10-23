package com.lqwd.repository;

import com.lqwd.model.entities.LspMonitorInvoice;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface LspMonitorInvoiceRepository extends JpaRepository<LspMonitorInvoice, Long> {

    Optional<LspMonitorInvoice> findByRhash(String rHash);
    Page<LspMonitorInvoice> findAllByUserId(String userId, Pageable pageable);

}
