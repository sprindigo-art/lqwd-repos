package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.Mservice;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MserviceRepository extends PagingAndSortingRepository<Mservice, UUID> {

    Optional<Mservice> findByClient(String client);
    Optional<Mservice> findById(UUID id);
    Optional<Mservice> findByName(String name);

    @Query(value = "SELECT * FROM mservice p where p.status='active'", nativeQuery = true)
    Page<Mservice> getAllNonDeleted(Pageable pageable);

    @Query(value = "SELECT * FROM mservice p where p.status='active'", nativeQuery = true)
    List<Mservice> listAllNonDeleted();
}