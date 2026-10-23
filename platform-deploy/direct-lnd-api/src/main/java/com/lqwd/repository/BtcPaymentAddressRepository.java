package com.lqwd.repository;

import com.lqwd.model.entities.BtcPaymentAddress;
import com.lqwd.model.entities.LspStaking;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface BtcPaymentAddressRepository extends JpaRepository<BtcPaymentAddress, Long> {

    Optional<BtcPaymentAddress> findByWalletAddress(String walletAddress);

}
