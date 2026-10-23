package com.lqwd.security.oauth2.repository;


import com.lqwd.security.oauth2.model.security.SharedLnds;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;


@Repository
public interface SharedLndsRepository extends PagingAndSortingRepository<SharedLnds, Integer> {

    @Query(value = "SELECT * FROM shared_lnds p where p.status='ACTIVE' and user_id=?1", nativeQuery = true)
    Collection<SharedLnds> findAllByUser_id(@Param("user_id") UUID user_id);

    @Query(value = "SELECT * FROM shared_lnds p where p.status='ACTIVE' and p.lndnodeinfo_id=?1", nativeQuery = true)
    Collection<SharedLnds> findAllByNode_idActive(Long id);

    @Query(value = "SELECT * FROM shared_lnds p where p.lndnodeinfo_id=?1", nativeQuery = true)
    Collection<SharedLnds> findAllByNode_id(Long id);


    @Transactional
    @Modifying
    @Query(value = "UPDATE shared_lnds SET status='DELETED', updated_at=?3 where user_id=?1 and  lndnodeinfo_id=?2", nativeQuery = true)
    void updateStatus(UUID newUser_id, Long lndNode_id, Timestamp updated_at);

    @Transactional
    @Modifying
    @Query(value = "UPDATE shared_lnds SET status='DELETED', updated_at=?3 where  lndnodeinfo_id=?2", nativeQuery = true)
    void updateStatusByLndNodeId(Long lndNode_id, Timestamp updated_at);


    @Query(value = "SELECT * FROM shared_lnds p where p.status='ACTIVE' and p.lndnodeinfo_id=?2 and p.user_id=?1 LIMIT 1", nativeQuery = true)
    Optional<SharedLnds> findByNode_idUser_id(UUID user_id, Long node_id);
}
