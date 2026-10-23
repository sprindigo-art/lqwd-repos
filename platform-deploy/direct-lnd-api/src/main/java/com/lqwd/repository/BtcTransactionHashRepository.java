package com.lqwd.repository;

import com.lqwd.model.entities.BtcTransactionHash;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface BtcTransactionHashRepository extends PagingAndSortingRepository<BtcTransactionHash, Long> {
    boolean existsByTrxHash(String trxHash);
    Optional<BtcTransactionHash> findByTrxHash(String trxHash);
}
