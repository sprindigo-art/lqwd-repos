package com.lqwd.repository;

import com.lqwd.model.entities.Application;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface ApplicationRepository extends PagingAndSortingRepository<Application, Long> {
    boolean existsByContactEmail(String emailAddress);
}
