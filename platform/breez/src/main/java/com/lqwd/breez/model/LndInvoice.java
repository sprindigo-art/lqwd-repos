package com.lqwd.breez.model;

import lombok.Builder;
import lombok.Getter;

import javax.persistence.*;

@Entity
@Table(name = "LND_INVOICE")
@Builder
@Getter
public class LndInvoice {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;

    @Column(name = "r_hash")
    private String rHash;

    @Column(name = "payment_request")
    private String paymentRequest;

    @Column(name = "payment_address")
    private String paymentAddress;

}
