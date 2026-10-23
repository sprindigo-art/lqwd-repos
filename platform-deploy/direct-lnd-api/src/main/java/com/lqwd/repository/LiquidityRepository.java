package com.lqwd.repository;

import com.lqwd.model.entities.Liquidity;
import com.lqwd.model.enums.LiquidityType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface LiquidityRepository extends JpaRepository<Liquidity, Long> {

    Liquidity findByChannelId (Long channelId);

    Optional<Liquidity> findByPaymentOptionIdAndType (Long paymentOptionId, LiquidityType type);

    @Query(value = "SELECT * FROM Liquidity p where p.user_id = ?1 order by p.date_modified desc", nativeQuery = true)
    Page<Liquidity> findAllByUserId(String userId, Pageable pageable);

    @Query(value = "SELECT * FROM Liquidity p WHERE p.user_id = ?1 AND p.type = ?2 order by p.date_modified desc", nativeQuery = true)
    Page<Liquidity> findAllByUserIdAndType(String userId, String type, Pageable pageable);

    @Query(value = "SELECT * FROM Liquidity p order by p.date_created desc", nativeQuery = true)
    Page<Liquidity> findAllOrderByCreatedAt(Pageable pageable);

}


