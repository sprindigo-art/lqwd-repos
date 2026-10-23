package com.lqwd.breez.repository;

import com.lqwd.breez.model.LndInvoice;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;

@Repository
public interface LndInvoiceRepository extends PagingAndSortingRepository<LndInvoice, Id> {

}
