package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.LndPort;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import javax.persistence.LockModeType;
import javax.persistence.QueryHint;
import java.util.Optional;

@Repository
public interface LNDPortRepository extends JpaRepository<LndPort, Long> {

    @Query(value = "SELECT * from lnd_port order by port asc", nativeQuery = true)
    Page<LndPort> getAll(Pageable page);

    @Modifying
    @Transactional
    @Query("update LndPort p set p.inUse = false where p.port = :port")
    int setPortAvailable(int port);

    @Lock(LockModeType.PESSIMISTIC_READ)
    @Transactional
    @QueryHints({@QueryHint(name = "javax.persistence.lock.timeout", value = "3000")})
    Optional<LndPort> findFirstByInUse(boolean inUse);

}
