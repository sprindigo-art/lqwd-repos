package com.lqwd.model.entities;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.io.Serializable;
import java.util.Date;

@Entity
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class Shedlock implements Serializable {
    @Id
    @Column(length = 64)
    private String name;
    @Temporal(TemporalType.TIMESTAMP)
    private Date lockUntil;
    @Temporal(TemporalType.TIMESTAMP)
    private Date lockedAt;
    private String lockedBy;
}
