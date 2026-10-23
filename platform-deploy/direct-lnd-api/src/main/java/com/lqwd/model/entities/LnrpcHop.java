package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.CascadeType;
import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.OneToOne;
import java.io.Serializable;

@Entity
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class LnrpcHop implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    private String chan_id;
    private String chan_capacity;
    private String amt_to_forward;
    @Column(length = 50)
    private String fee;
    private int expiry;
    private String amt_to_forward_msat;
    @Column(length = 100)
    private String fee_msat;
    private String pub_key;
    private boolean tlv_payload;
    @OneToOne(cascade = CascadeType.ALL)
    private LnrpcMppRecord mpp_record;
    @OneToOne(cascade = CascadeType.ALL)
    private LnrpcAmpRecord amp_record;
    private String metadata;
}
