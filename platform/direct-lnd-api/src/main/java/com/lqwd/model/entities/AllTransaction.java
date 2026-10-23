package com.lqwd.model.entities;


import lombok.Data;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.Subselect;

import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Table;
import java.io.Serializable;
import java.util.Date;

@Entity
@Immutable
@Table(name = "`all_transaction`")
@Subselect("select gen_random_uuid() as id, a.* from all_transaction a")
@Data
public class AllTransaction implements Serializable {

    @Id
    private String id;
    private String node;
    private String trxId;
    private String type;
    private Long amount;
    private String state;
    private String userId;
    private Date created;


}
