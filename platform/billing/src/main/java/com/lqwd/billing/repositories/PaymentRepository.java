package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.Payment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Date;
import java.util.List;

public interface PaymentRepository extends JpaRepository<Payment, Long> {

    @Query("select p from Payment p where p.dateCreated >= :startDate and p.dateCreated <= :endDate and p.userId = :userId")
    List<Payment> getPaymentHistory(Date startDate, Date endDate, String userId);

}
