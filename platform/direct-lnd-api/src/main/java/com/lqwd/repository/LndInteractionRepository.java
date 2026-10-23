package com.lqwd.repository;

import com.lqwd.model.entities.LndInteraction;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;


@Repository
public interface LndInteractionRepository extends PagingAndSortingRepository<LndInteraction, Long> {

}
