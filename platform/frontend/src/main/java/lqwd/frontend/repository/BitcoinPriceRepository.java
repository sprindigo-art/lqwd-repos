package lqwd.frontend.repository;

import lqwd.frontend.model.BitcoinPrice;
import org.springframework.stereotype.Repository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

@Repository
public interface BitcoinPriceRepository extends org.springframework.data.repository.Repository<BitcoinPrice,Long> {

    @Query(value = "SELECT * FROM  price_usd_cad ORDER BY last_updated DESC LIMIT 1", nativeQuery = true)
    BitcoinPrice getLatestPrice();

}
