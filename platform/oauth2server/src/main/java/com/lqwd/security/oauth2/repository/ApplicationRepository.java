package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.Application;
import com.lqwd.security.oauth2.model.security.User_;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ApplicationRepository extends PagingAndSortingRepository<Application, Long> {

    @Query(value = "SELECT * from application", nativeQuery = true)
    Page<Application> getAll(Pageable page);

    boolean existsByContactEmail(String emailAddress);

    Optional<Application> findByContactEmail(String email);
}
