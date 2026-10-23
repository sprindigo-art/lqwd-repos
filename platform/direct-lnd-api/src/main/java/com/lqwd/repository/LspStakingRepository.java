package com.lqwd.repository;

import com.lqwd.model.entities.LspStaking;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface LspStakingRepository extends JpaRepository<LspStaking, Long> {

    @Query(value = "select lsp.staking_type, lsp.amount, lsp.days, lsp.created, lsp.status, lsp.node_name, btc.wallet_address, iv.payment_address, iv.payment_request, iv.hash_str, lsp.payment_date  from lsp_staking lsp left join btc_payment_address btc on (btc.id = lsp.staking_reference and lsp.staking_type = 'BTCADDRESS') left join invoice iv on (iv.id = lsp.staking_reference and lsp.staking_type = 'INVOICE') where lsp.user_id = ?1 and lsp.node_name like ( ?2 ) and lsp.status like ( ?3 ) order by lsp.created DESC",
            countQuery = "select count(id) from lsp_staking where user_id = ?1 and node_name like ( ?2 ) and status like ( ?3 )",
            nativeQuery = true)
    Page<Object[]> listAllByUserAndQueryAndStatus(String userId, String query, String status, Pageable page);


    Optional<LspStaking> findByStakingReferenceAndStakingType(Long StakingReference, LspStaking.StakingType stakingType);
}
