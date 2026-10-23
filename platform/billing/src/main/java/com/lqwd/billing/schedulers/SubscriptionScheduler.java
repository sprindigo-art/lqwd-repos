package com.lqwd.billing.schedulers;

import com.lqwd.billing.services.SubscriptionRequestService;
import com.lqwd.billing.services.SubscriptionService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class SubscriptionScheduler {
//Commented for subscriptions...Hive Request
//    Logger logger = LoggerFactory.getLogger(SubscriptionScheduler.class);
//
//    private final SubscriptionService subscriptionService;
//    private final SubscriptionRequestService subscriptionRequestService;
//
//    //    @Scheduled(cron = "0 0/15 * * * *")
//    @Scheduled(cron = "0 1 12 * * *")
////    @SchedulerLock(name = "handleSubscription", lockAtLeastFor = "PT3M", lockAtMostFor = "PT5M")
//    public void handleActiveSubscriptions() {
//        logger.info("Running handle active subscription task");
//        subscriptionService.handleSubscriptions();
//    }
//
//    //    @Scheduled(cron = "0 0/15 * * * *")
//    @Scheduled(cron = "0 1 12 * * *")
////    @SchedulerLock(name = "handleSubscription", lockAtLeastFor = "PT3M", lockAtMostFor = "PT5M")
//    public void handleSuspendedSubscriptions() {
//        logger.info("Running handle suspend sub task");
//        subscriptionService.handleSuspendedSubscriptions();
//    }
//
//    @Scheduled(cron = "0 1 12 * * *")
////    @SchedulerLock(name = "handleSubscription", lockAtLeastFor = "PT3M", lockAtMostFor = "PT5M")
//    public void handleExpiredSubscriptionRequests() {
//        logger.info("Running handle subscription request");
//        subscriptionRequestService.handleExpiredSubscriptionRequests();
//    }
//
//    @Scheduled(fixedRate = 300000)
////    @SchedulerLock(name = "handleSubscription", lockAtLeastFor = "PT3M", lockAtMostFor = "PT5M")
//    public void handleCancelledSubscription() {
//        logger.info("Running handle cancelled subscriptions");
//        subscriptionService.handleCancelledSubscriptions();
//    }
//
//    @Scheduled(cron = "0 1 12 * * *")
////    @SchedulerLock(name = "handleSubscription", lockAtLeastFor = "PT3M", lockAtMostFor = "PT5M")
//    public void handleSubscriptionReminders() {
//        logger.info("Running handle subscription reminder");
//        subscriptionService.handleSubscriptionReminders();
//    }


}
