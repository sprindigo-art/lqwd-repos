package lqwd.frontend.model;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.io.Serializable;
import java.util.Date;

@Entity
@Table(name = "price_usd_cad")
@Getter
@Setter
public class BitcoinPrice implements Serializable {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name = "primary_id", updatable = false, nullable = false)
    private Long primary_id;

    @Column(name="cad", length = 50)
    private Double cad;

    @Column(name="usd", length = 50)
    private Double usd;

    @Column(name="last_updated", length = 50)
    private Date last_updated;


    @Override
    public String toString(){

        return "\nBitcoinPrice: " + this.getPrimary_id() + "\n"
                + "CAD Price: " + this.getCad() + "\n"
                + "USD Price: " + this.getUsd() + "\n"
                + "Last Updated: " + this.getLast_updated();
    }


}
