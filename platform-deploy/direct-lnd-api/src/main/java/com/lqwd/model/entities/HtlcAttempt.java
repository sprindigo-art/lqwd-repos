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
public class HtlcAttempt implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private Long id;
    private String attempt_id;
    @Column(length = 100)
    private String attempt_time_ns;
    @Column(length = 100)
    private String resolve_time_ns;
    private String preimage;
    private String status;
    @OneToOne(cascade = CascadeType.ALL)
    private LnrpcRoute route;
    private String failure;

}
