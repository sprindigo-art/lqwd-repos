package com.lqwd.repository;

import com.lqwd.model.entities.LndNodeDetail;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface LndNodeInfoRepository extends JpaRepository<LndNodeDetail, Long> {
    Optional<LndNodeDetail> findByNodeName(String nodeName);
    long deleteByNodeName(String nodeName);
}
