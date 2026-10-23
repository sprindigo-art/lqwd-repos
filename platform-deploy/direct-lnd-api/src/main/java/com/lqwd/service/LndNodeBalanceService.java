package com.lqwd.service;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.model.entities.LndNodeBalance;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.repository.LndNodeBalanceRepository;
import com.lqwd.utils.DateUtil;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Service
@RequiredArgsConstructor
public class LndNodeBalanceService {

    private final LndNodeBalanceRepository lndNodeBalanceRepository;
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final HttpClientToken httpClientToken;


    private LndNodeBalance createBalance(LndNodeBalance info){

        return lndNodeBalanceRepository.save(info);
    }


    public LndNodeBalance createBalanceFromMonitoring(JSONObject balanceObj, String nodeName, String userId){

        LndNodeBalance nodeBalance = lndNodeBalanceRepository.
                findFirstByNodeNameOrderByDateCreatedDesc(nodeName);



        LndNodeBalance balance = new LndNodeBalance();
        balance.setNodeName(nodeName);
        balance.setUserId(userId);
        balance.setTotal_balance(balanceObj.getString("total_balance"));
        balance.setConfirmed_balance(balanceObj.getString("confirmed_balance"));
        balance.setUnconfirmed_balance(balanceObj.getString("unconfirmed_balance"));

        if(!balance.hasChanged(nodeBalance))
            return null;

        return createBalance(balance);
    }

    public LndNodeBalance getNodeLatestBalance(String nodeName){
        return lndNodeBalanceRepository.findFirstByNodeNameOrderByDateCreatedDesc(nodeName);
    }

    public ApiResponse<Long> getTotalNodeBalancesForUser(OAuth2Authentication authentication){
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse userinfo = httpClientToken.userInfo(token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        List<LndNodeBalance> balances = lndNodeBalanceRepository.findAllLatestBalancesForUser(userId);

        Long balance = balances.stream().map(b -> Long.valueOf(b.getConfirmed_balance()))
                .reduce(0l, (a, b) -> a + b);

        return new ApiResponse<>(balance, "success");
    }

    public ApiResponse<Map<String, Long>> getUserTotalNodeBalanceHistory(
            String startDate, String endDate, OAuth2Authentication authentication){

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse userinfo = httpClientToken.userInfo(token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        Map<String, Long> res = getUserTotalNodeBalanceHistory(userId, startDate, endDate);

        return new ApiResponse<>(res, "Success");


    }

    private Map<String, Long> getUserTotalNodeBalanceHistory(String userId, String startDate, String endDate){

        Date start = DateUtil.validateDateFormat(startDate, "dd-MM-yyyy");
        Date end = DateUtil.validateDateFormat(endDate, "dd-MM-yyyy");

        List<LndNodeBalance> balances = lndNodeBalanceRepository.findAllByStartDateAndEndDate(start, end, userId);


        List<LocalDate> dates = getDatesBetweenUsingJava8(convertToLocalDateViaSqlDate(start),
                convertToLocalDateViaSqlDate(end));

        SortedMap<String, Long> balanceMap = new TreeMap<>();
        SimpleDateFormat format = new SimpleDateFormat("dd/MM/yyyy");

        for(LocalDate date : dates){
            balanceMap.put(date.format(DateTimeFormatter.ofPattern("dd/MM/yyyy")), 0l);
        }

        for(LndNodeBalance bal : balances){
                Long b = balanceMap.get(format.format(bal.getDateCreated()));
                b += Long.valueOf(bal.getConfirmed_balance());
                balanceMap.put(format.format(bal.getDateCreated()), b);
        }

        Long previousBalance = 0l;

        for (Map.Entry<String,Long> entry: balanceMap.entrySet()){
            if(entry.getValue() == 0l && previousBalance > 0l) {
                entry.setValue(previousBalance);
            }
            previousBalance = entry.getValue();
        }


        return balanceMap;

    }

    private static List<LocalDate> getDatesBetweenUsingJava8(
            LocalDate startDate, LocalDate endDate) {

        long numOfDaysBetween = ChronoUnit.DAYS.between(startDate, endDate);
        return IntStream.iterate(0, i -> i + 1)
                .limit(numOfDaysBetween)
                .mapToObj(i -> startDate.plusDays(i))
                .collect(Collectors.toList());
    }

    private LocalDate convertToLocalDateViaSqlDate(Date dateToConvert) {
        return new java.sql.Date(dateToConvert.getTime()).toLocalDate();
    }

}