package com.lqwd.service;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.lqwd.exceptions.BadRequestException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.AllTransaction;
import com.lqwd.model.entities.LndPayment;
import com.lqwd.model.entities.LndPaymentIndex;
import com.lqwd.model.entities.LspTransaction;
import com.lqwd.model.entities.UserLndChannel;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.repository.AllTransactionRepository;
import com.lqwd.repository.LNDPaymentIndexRepository;
import com.lqwd.repository.LNDPaymentRepository;
import com.lqwd.repository.LspTransactionRepository;
import com.lqwd.utils.DateUtil;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.json.JSONObject;
import org.springframework.data.domain.Example;
import org.springframework.data.domain.ExampleMatcher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import javax.persistence.criteria.Predicate;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class LNDTransactionService {


    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final HttpClientToken httpClientToken;
    private final LndHttpClient lndHttpClient;
    private final LspTransactionRepository lspTransactionRepository;
    private final LNDPaymentRepository lndPaymentRepository;
    private final LNDPaymentIndexRepository paymentIndexRepository;

    private final AllTransactionRepository allTransactionRepository;


    public ApiResponse<PageResponse<LspTransaction>> findUserTransaction(int pageNo, int pageSize,
                                                                         String nodeName,
                                                                         OAuth2Authentication authentication) {

        String userId = getUserIdFromAuthentication(authentication);

        return new ApiResponse<>(findUserTransaction(pageNo, pageSize, nodeName, userId),
                "Request successful");


    }

    public PageResponse<LspTransaction> findUserTransaction(int pageNo, int pageSize,
                                                            String nodeName, String userId) {

        LspTransaction lspTransaction = new LspTransaction();
        lspTransaction.setUserId(userId);
        lspTransaction.setNodeName(nodeName);

        ExampleMatcher matcher = ExampleMatcher.matching().withIgnoreNullValues()
                .withIgnorePaths("outputDetails", "amount");
        Example<LspTransaction> exampleQuery = Example.of(lspTransaction, matcher);

        Page<LspTransaction> transactions = lspTransactionRepository
                .findAll(exampleQuery, PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC,
                        "created")));

        return new PageResponse<>(pageNo, pageSize, transactions.getTotalElements(), transactions.getContent()
                , transactions.getTotalPages());


    }


    private String getUserIdFromAuthentication(OAuth2Authentication authentication)
            throws BadRequestException {
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        if (token == null)
            throw new BadRequestException(401, "Couldn't determine user for this request");

        MainResponse userinfo = httpClientToken.userInfo(
                token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        return UserUtil.retrieveUserId(userinfo.getObject());
    }


    public ApiResponse<PageResponse> listLNDPayment(int pageNo, int pageSize,
                                                    boolean shouldSync, String nodeName,
                                                    OAuth2Authentication authentication) {

        if (shouldSync)
            syncNodePayments(nodeName, authentication);

        Page<LndPayment> payments = lndPaymentRepository.findByNodeName(nodeName,
                PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC,
                        "creationTimeNs")));

        PageResponse<LndPayment> pageResponse = new PageResponse<>(
                pageNo, pageSize, payments.getTotalElements(),
                payments.getContent(), payments.getTotalPages()
        );

        return new ApiResponse<>(pageResponse, "Request successful");

    }

    private void syncNodePayments(String nodeName, OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse infoResponse = httpClientToken.lndNodeInfo(token, nodeName, "/lndnode/getinfo",
                "LndNodeInfo");

       syncNodePayments(infoResponse, nodeName);

    }

    public void syncNodePayments(MainResponse infoResponse, String nodeName){
        if (infoResponse.getStatus() != 200)
            throw new BadRequestException(infoResponse.getStatus(), "Cannot handle this request");

        JSONObject jsonData = new JSONObject(infoResponse.getObject());

        String nodeAddress = jsonData.getString("privateAddress");
        String userId = jsonData.getString("userId");

        LndPaymentIndex index = paymentIndexRepository.findByNodeName(nodeName)
                .orElse(new LndPaymentIndex());

        long indexOffset = index.getPaymentIndex();
        long newIndexOffset = syncPaymentsForNode(nodeName, userId, indexOffset, nodeAddress);

        if(newIndexOffset > indexOffset){
            index.setPaymentIndex(newIndexOffset);
            index.setNodeName(nodeName);
            paymentIndexRepository.save(index);
        }
    }

    private Long syncPaymentsForNode(String nodeName, String userId,
                                     long startIndex, String nodeAddress) {

        LNDResponse lndResponse;

        Map<String, Object> params = new HashMap<>();
        params.put("index_offset", Long.toString(startIndex));

        System.out.println("index offset is "+ startIndex);

        try {

            lndResponse = lndHttpClient.getRequestToLndPod("v1/payments",
                    nodeAddress, Optional.of(params), nodeName, null);

        } catch (Exception e) {
            return null;
        }

        if (lndResponse.getStatus() != 200)
            return null;

        JSONObject response = new JSONObject(lndResponse.getResponse());

        Type listType = new TypeToken<ArrayList<LndPayment>>() {
        }.getType();


        List<LndPayment> payments = new Gson().fromJson(
                response.getJSONArray("payments").toString(), listType);


        for(LndPayment payment : payments){
            payment.setNodeName(nodeName);
            payment.setUserId(userId);
        }

        lndPaymentRepository.saveAll(payments);

        return response.getLong("last_index_offset");

    }


    public PageResponse<AllTransaction> findAllTransactions(OAuth2Authentication authentication, String nodes,
                                                             int pageNo, int pageSize, String states, String types,
                                                             String from, String to, String queryStr) {

        String userId = getUserIdFromAuthentication(authentication);

        List<String> nodeList = new ArrayList<>();
        List<String> statesList = new ArrayList<>();
        List<String> typesList = new ArrayList<>();

        if (!StringUtils.isEmpty(nodes)) {
            nodes = nodes.replaceAll("\\s+", "");
            nodeList = Arrays.asList(nodes.split(","));
        }

        if (!StringUtils.isEmpty(types)) {
            types = types.replaceAll("\\s+", "");
            typesList = Arrays.asList(types.split(","));
        }

        if (!StringUtils.isEmpty(states)) {
            states = states.replaceAll("\\s+", "");
            statesList = Arrays.asList(states.split(","));
        }

        Date start = DateUtil.validateDateFormat(from, "dd-MM-yyyy");
        Date end = DateUtil.validateDateFormat(to, "dd-MM-yyyy");

        return findAllTransactions(nodeList, userId, pageNo,pageSize,
                statesList, typesList, start, end, queryStr);

    }

    private PageResponse<AllTransaction> findAllTransactions(List<String> nodes, String userId,
                                                             int pageNo, int pageSize, List<String> states,
                                                             List<String> types,
                                                             Date from, Date to, String queryStr) {




        Specification<AllTransaction> specification = (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();

            predicates.add(builder.like(root.get("userId"), userId));

            Predicate p1 = builder.greaterThanOrEqualTo(root.get("created"), from);
            Predicate p2 = builder.lessThanOrEqualTo(root.get("created"), to);
            predicates.add(builder.and(p1, p2));

            predicates.add(builder.like(root.get("userId"), userId));

            if (!types.isEmpty()) {
                predicates.add(root.get("type").in(types));
            }

            if (!nodes.isEmpty()) {
                predicates.add(root.get("node").in(nodes));
            }

            if (!states.isEmpty()) {
                predicates.add(root.get("state").in(states));
            }

            if (!StringUtils.isEmpty(queryStr)) {
                predicates.add ( builder.like(builder.lower(root.get("trxId")),
                        "%" + queryStr.toLowerCase() + "%"));

            }

            return builder.and(predicates.toArray(new Predicate[predicates.size()]));

        };


        Page<AllTransaction> transactions = allTransactionRepository
                .findAll(specification, PageRequest.of(pageNo, pageSize));

        return new PageResponse<>(pageNo, pageSize, transactions.getTotalElements(), transactions.getContent()
                , transactions.getTotalPages());


    }


}
