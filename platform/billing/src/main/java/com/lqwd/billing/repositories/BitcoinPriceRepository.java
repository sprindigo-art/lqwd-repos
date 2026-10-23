package com.lqwd.billing.repositories;

import com.lqwd.billing.entities.BitcoinPrice;
import liquibase.pro.packaged.S;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.text.SimpleDateFormat;
import java.util.Date;

@Repository
public interface BitcoinPriceRepository extends JpaRepository<BitcoinPrice,Long> {

    @Query(value = "SELECT * FROM  price_usd_cad WHERE last_updated IS NOT NULL AND usd IS NOT NULL AND cad IS NOT NULL ORDER BY last_updated DESC LIMIT 1", nativeQuery = true)
    BitcoinPrice getLatestPrice();

    @Modifying
    @Transactional
    @Query(value = "INSERT INTO price_usd_cad(cad, usd, last_updated) VALUES (:cad, :usd, :lastUpdated)", nativeQuery = true)
    void insertLatestPrice(@Param("cad") Double cad, @Param("usd") Double usd, @Param("lastUpdated") Date lastUpdated);
}

