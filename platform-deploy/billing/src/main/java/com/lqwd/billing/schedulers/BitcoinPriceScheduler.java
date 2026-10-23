package com.lqwd.billing.schedulers;

import com.lqwd.billing.entities.BitcoinPrice;
import com.lqwd.billing.repositories.BitcoinPriceRepository;
import com.lqwd.billing.services.BitcoinPriceService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
@RequiredArgsConstructor
public class BitcoinPriceScheduler {

    Logger logger = LoggerFactory.getLogger(BitcoinPriceScheduler.class);

    private final BitcoinPriceService bitcoinPriceService;
    private final BitcoinPriceRepository bitcoinPriceRepository;

    @Scheduled(cron = "0 0 * * * *")
    public void handleUpdateBitcoinPrice() throws IOException {
        BitcoinPrice bitcoinPriceUSD = bitcoinPriceService.getBitcoinPriceUSD();
        BitcoinPrice bitcoinPriceCAD = bitcoinPriceService.getBitcoinPriceCAD();

        bitcoinPriceCAD.setUsd(bitcoinPriceUSD.getUsd());
        logger.info(bitcoinPriceCAD.toString());

        bitcoinPriceRepository.insertLatestPrice(bitcoinPriceCAD.getCad(), bitcoinPriceUSD.getUsd(), bitcoinPriceCAD.getLast_updated());

        logger.info("Running Bitcoin Price Updater");
    }
}
