package com.lqwd.repository;

import com.lqwd.model.entities.LndConfig;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface LndConfigRepository extends PagingAndSortingRepository<LndConfig, Long> {

    @Query(value = "SELECT * FROM lnd_config p WHERE p.status = ?1 ORDER BY p.id ASC FETCH  FIRST ROW ONLY", nativeQuery = true)
    Optional<LndConfig> findByStatus(String free);

    @Query(value = "SELECT * FROM lnd_config p ORDER BY p.id DESC FETCH  FIRST ROW ONLY", nativeQuery = true)
    Optional<LndConfig> findLast();

    @Query(value = "SELECT * FROM lnd_config p WHERE p.label=?1 ", nativeQuery = true)
    Optional<LndConfig> findByLndnodename(String lndnodename);
}
