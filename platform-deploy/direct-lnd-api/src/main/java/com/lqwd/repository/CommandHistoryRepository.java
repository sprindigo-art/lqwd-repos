package com.lqwd.repository;

import com.lqwd.model.entities.CommandHistory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;



@Repository
public interface CommandHistoryRepository extends PagingAndSortingRepository<CommandHistory, Long> {

    @Query(value = "SELECT * FROM command_history p where p.apikey = ?1 order by p.date asc", nativeQuery = true)
    Page<CommandHistory> findAllByApikey(String apikey, Pageable pageable);
}
