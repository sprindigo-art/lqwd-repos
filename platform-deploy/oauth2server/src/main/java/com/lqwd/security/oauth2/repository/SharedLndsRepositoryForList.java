package com.lqwd.security.oauth2.repository;



import com.lqwd.security.oauth2.model.security.SharedLndsForList;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;



import java.util.Collection;
import java.util.Optional;
import java.util.UUID;


@Repository
public interface SharedLndsRepositoryForList extends PagingAndSortingRepository<SharedLndsForList, Integer> {

    @Query(value = "SELECT * FROM shared_lnds p where p.status='ACTIVE' and user_id=?1", nativeQuery = true)
    Collection<SharedLndsForList> findAllByUser_id(@Param("user_id") UUID user_id);

    @Query(value = "SELECT * FROM shared_lnds p where p.status='ACTIVE' and p.lndnodeinfo_id=?1", nativeQuery = true)
    Collection<SharedLndsForList> findAllByNode_idActive(Long id);


    @Query(value = "SELECT * FROM shared_lnds p where p.status='ACTIVE' and p.lndnodeinfo_id=?2 and p.user_id=?1 LIMIT 1", nativeQuery = true)
    Optional<SharedLndsForList> findByNode_idUser_id(UUID user_id, Long node_id);
}
