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
import javax.persistence.OneToMany;
import java.io.Serializable;
import java.util.List;

@Entity
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class LnrpcRoute implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    private int total_time_lock;
    @Column(length = 50)
    private String total_fees;
    @Column(length = 50)
    private String total_amt;
    @Column(length = 50)
    private String total_fees_msat;
    @Column(length = 50)
    private String total_amt_msat;
    @OneToMany(cascade = CascadeType.ALL)
    private List<LnrpcHop> hops;


}
