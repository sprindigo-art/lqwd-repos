package com.lqwd.security.oauth2.repository;


import com.lqwd.security.oauth2.model.security.LndNodeInfo;
import com.lqwd.security.oauth2.model.security.User_;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;
import java.util.List;
import java.util.Optional;
import java.util.UUID;


@Repository
public interface LndNodeInfoRepository extends JpaRepository<LndNodeInfo, Id> {

    @Override
    void delete(LndNodeInfo lndNodeInfo);

    Optional<LndNodeInfo> findById(Long id);

    @Query(value = "SELECT * FROM lndnodeinfo p where p.lndnodename=?1", nativeQuery = true)
    Optional<LndNodeInfo> findByLndNodeName(String lndNodeName);

    @Query(value = "SELECT count(*) FROM lndnodeinfo p where p.status='CREATING' and p.user_id=?1", nativeQuery = true)
    int countLndNodeInCreation(UUID userId);

    @Query(value = "SELECT count(*) FROM lndnodeinfo p where p.paid=false and p.status!='DELETED' and p.user_id=?1", nativeQuery = true)
    int countLndNodeNotPaid(UUID userId);

    @Query(value = "SELECT * FROM lndnodeinfo p where p.user_id=?1", nativeQuery = true)
    List<LndNodeInfo> findByUser(UUID id);

    @Query(value = "SELECT * FROM lndnodeinfo p where p.user_id=?1 and p.id=?2", nativeQuery = true)
    Optional<LndNodeInfo> findByIdandUser(UUID id, Long lndNodeId);

    @Query(value = "SELECT * FROM lndnodeinfo p where p.lndnodename = ?1 and p.user_id=?2", nativeQuery = true)
    Optional<LndNodeInfo> findByLndnodenameAndUser(String lndNodeName, UUID user_id);

    @Query(value = "SELECT * FROM lndnodeinfo p where p.id = ?1 and p.user_id=?2", nativeQuery = true)
    Optional<LndNodeInfo> findByLndnodeIdAndUser(Long lndNodeId, UUID userId);
}
