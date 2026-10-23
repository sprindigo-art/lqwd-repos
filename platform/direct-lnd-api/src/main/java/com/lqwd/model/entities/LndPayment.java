package com.lqwd.model.entities;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.google.gson.annotations.SerializedName;
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
import javax.persistence.OneToMany;
import java.io.Serializable;
import java.util.List;

@Entity
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class LndPayment implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    @Column(unique = true)
    private String payment_hash;
    private String payment_preimage;
    @Column(length = 50)
    private String value_msat;
    @Column(length = 50)
    private String value_sat;
    @Column(columnDefinition = "TEXT")
    private String payment_request;
    private String status;
    @Column(length = 50)
    private String fee_sat;
    @Column(length = 50)
    private String fee_msat;
    private String nodeName;
    private String userId;
    @SerializedName("creation_time_ns")
    @JsonProperty("creation_time_ns")
    private String creationTimeNs;
    @OneToMany(cascade = CascadeType.ALL)
    private List<HtlcAttempt> htlcs;
    private String payment_index;
    private String failure_reason;


}