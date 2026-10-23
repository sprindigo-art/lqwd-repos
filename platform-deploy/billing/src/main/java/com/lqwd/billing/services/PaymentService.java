package com.lqwd.billing.services;

import com.lqwd.billing.clients.HttpClientToken;
import com.lqwd.billing.entities.Payment;
import com.lqwd.billing.exceptions.BadRequestException;
import com.lqwd.billing.models.ApiResponse;
import com.lqwd.billing.models.MainResponse;
import com.lqwd.billing.models.PaymentHistory;
import com.lqwd.billing.repositories.PaymentRepository;
import com.lqwd.billing.util.DateUtil;
import com.lqwd.billing.util.UserUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.text.SimpleDateFormat;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentRepository paymentRepository;

    private final HttpClientToken httpClientToken;


    public ApiResponse<Collection<PaymentHistory>> getMyPaymentHistory(
            String startDate, String endDate, String accessToken){

        MainResponse userinfo = httpClientToken.userInfo(
                accessToken);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        return new ApiResponse<>(getPaymentsHistory(startDate, endDate, userId),
                true, "history retrieved successfully");

    }

    public Collection<PaymentHistory> getPaymentsHistory(String startDate, String endDate, String userId) {

        Date start = DateUtil.validateDateFormat(startDate, "dd-MM-yyyy");
        Date end = DateUtil.validateDateFormat(endDate, "dd-MM-yyyy");

        List<Payment> payments = paymentRepository.getPaymentHistory(start
                , end, userId);

        SimpleDateFormat format = new SimpleDateFormat("MM-yyyy");

        Map<String, PaymentHistory> history = new HashMap<>();

        for(Payment p : payments){

            PaymentHistory pHistory = history.get(format.format(p.getDateCreated()));

            if (pHistory == null){
                pHistory = new PaymentHistory();
            }

            pHistory.getPayments().add(p);
            pHistory.setDate(format.format(p.getDateCreated()));
            pHistory.setTotalAmount(pHistory.getTotalAmount() + p.getAmount());
            history.put(format.format(p.getDateCreated()), pHistory);

        }

        return history.values();


    }



}
