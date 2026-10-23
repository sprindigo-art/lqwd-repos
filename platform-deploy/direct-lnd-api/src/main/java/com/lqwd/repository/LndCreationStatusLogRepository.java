package com.lqwd.repository;

import com.lqwd.model.entities.LndCreationStatusLog;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface LndCreationStatusLogRepository extends PagingAndSortingRepository<LndCreationStatusLog, Long> {



}
