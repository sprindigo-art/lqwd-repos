package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.BtcPaymentAddress;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface BtcPaymentAddressRepository extends JpaRepository<BtcPaymentAddress, Long> {

    Optional<BtcPaymentAddress> findByWalletAddress(String walletAddress);

}
