package com.lqwd.configurationserver;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class Scheduler {

    Logger logger = LoggerFactory.getLogger(Scheduler.class);

    private final GitPoolService gitPoolService;

    @Scheduled(fixedRate = 600000)
    public void pollChangesFromRepository(){
        logger.info("Polling for changes in repository");
        gitPoolService.pollChangesFromRepository();
    }

}