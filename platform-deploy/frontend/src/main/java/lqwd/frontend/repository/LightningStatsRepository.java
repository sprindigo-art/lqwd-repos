package lqwd.frontend.repository;

import lqwd.frontend.model.BetaSignup;
import lqwd.frontend.model.LightningStats;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.Date;

@Repository
public interface LightningStatsRepository extends CrudRepository<LightningStats,Long> {

    @Query(value="SELECT * FROM ml_stats_daily WHERE numberofnodes > 0 ORDER BY lastupdated ASC", nativeQuery = true)
    ArrayList<LightningStats> getLightningStatsByLastupdated();

    @Query(value="SELECT * FROM ml_stats_daily WHERE numberofnodes > 0 ORDER BY lastupdated DESC LIMIT 1", nativeQuery = true)
    LightningStats getLatestLightningStatsByLastupdated();

}
