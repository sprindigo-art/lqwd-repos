package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.AccountType;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import java.util.List;


@Repository
public interface AccountTypeRepository extends PagingAndSortingRepository<AccountType, Long> {

    @Query(value = "SELECT * FROM accounttype p ", nativeQuery = true)
    Page<AccountType> findAllNonDeleted(Pageable pageable);

    @Query(value = "SELECT * FROM accounttype p where status='active'  ", nativeQuery = true)
    List<AccountType> getAllNonDeleted();
}
