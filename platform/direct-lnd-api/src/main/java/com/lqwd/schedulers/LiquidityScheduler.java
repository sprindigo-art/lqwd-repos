package com.lqwd.schedulers;

import com.lqwd.repository.AllTransactionRepository;
import com.lqwd.service.BtcTransactionHashService;
import com.lqwd.service.LiquidityService;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.core.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class LiquidityScheduler {

    Logger logger = LoggerFactory.getLogger(LiquidityScheduler.class);

//    private final LiquidityService liquidityService;
//    private final BtcTransactionHashService btcTransactionHashService;

    private final AllTransactionRepository allTransactionRepository;

////    @Scheduled(cron = "0 0/15 * * * *")
//    @Scheduled(fixedRate = 300000)
//    @SchedulerLock(name = "closeLiquidityChannel", lockAtLeastForString = "PT3M", lockAtMostForString = "PT5M")
//    public void closeLiquidityChannels(){
//        logger.info("Running close liquidity channel task");
//        liquidityService.handleCloseLiquidity();
//    }
//
//    @Scheduled(fixedRate = 600000)
//    @SchedulerLock(name = "queryBTCTransactionConf", lockAtLeastForString = "PT3M", lockAtMostForString = "PT5M")
//    public void queryBTCTransactionConf(){
//        logger.info("Running queryBTCTransactionConf task");
//        btcTransactionHashService.checkNoOfConfirmationOnBTCD();
//    }

    @Scheduled(fixedRate = 600000)
    @SchedulerLock(name = "refreshView", lockAtLeastForString = "PT3M", lockAtMostForString = "PT5M")
    public void refreshViews(){
        logger.info("Running refresh view task");
        allTransactionRepository.refreshView();
    }



}
