package com.lqwd.service;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.exceptions.ServerErrorException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.LndAddress;
import com.lqwd.model.entities.LndInteraction;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.repository.LndAddressRepository;
import com.lqwd.utils.LndUtil;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class LndAddressService {

    private final static Logger logger = LoggerFactory.getLogger(LndAddressService.class);

    private final LndAddressRepository lndAddressRepository;
    private final HttpClientToken httpClientToken;
    private final LndHttpClient lndHttpClient;
    private final LndInteractionService lndInteractionService;
    private final AccessTokenServiceHelper accessTokenServiceHelper;

    public LndAddress save(LndAddress lndAddress) {
        return lndAddressRepository.save(lndAddress);
    }

    public List<LndAddress> findByNodeName(String nodeName) {
        return lndAddressRepository.findByNodeName(nodeName);
    }

    public ApiResponse<List<LndAddress>> getNodeAddresses(String nodeName) {

        List<LndAddress> addresses = findByNodeName(nodeName);

        return new ApiResponse<>(200, addresses, "Request successful");
    }

    public  ApiResponse<LndAddress> createNodeAddress(String nodeName,String passphrase, String password,
                                                      OAuth2Authentication authentication)
            throws JSONException, UnsupportedEncodingException {

       String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.authenticate(password, token);

        if (response.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

        MainResponse userinfo = httpClientToken.userInfo(
                token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());
        String email = UserUtil.retrieveUserEmail(userinfo.getObject());
        return createNodeAddressForUser(nodeName, passphrase, userId,token, email);

    }

    public ApiResponse<LndAddress> createNodeAddressForUser(String nodeName, String password, String userId, String token, String email) {

        MainResponse response = httpClientToken.lndNodeInfo(token, nodeName, "/lndnode/getinfo",
                "LndNodeInfo");

        if (response.getStatus() == 500)
            return new ApiResponse<>(401, null, "Invalid apiKey provided");

        try {
            //checking role for access to LND
            JSONObject jsonData = new JSONObject(response.getObject());
            String lndNodeRole = jsonData.getString("nodeRole");
            if(lndNodeRole!= null && !lndNodeRole.equals("OWNER")){
                nodeName = nodeName+"_"+ email;
            }
            return getLndAddressApiResponse(nodeName, password, userId, response);


        } catch (Exception e) {

            logger.info("An exception occurred when creating new address on {} error is: {} ",
                    nodeName, e.getMessage());

            return new ApiResponse<>(400, null,
                    e.getMessage());

        }


    }

    private ApiResponse<LndAddress> getLndAddressApiResponse(String nodeName, String password, String userId,
                                                             MainResponse response) throws Exception {

        JSONObject jsonData = new JSONObject(response.getObject());

        String nodeAddress = jsonData.getString("privateAddress");

        LNDResponse addressResponse = lndHttpClient.getRequestToLndPod("v1/newaddress", nodeAddress, Optional.empty(),
                nodeName, password);

        if (addressResponse.getStatus() != 200)
            return new ApiResponse<>(400, null,
                    "An unexpected error occurred when creating address");

        JSONObject jsonObject = new JSONObject(addressResponse.getResponse());

        LndAddress address = LndAddress.builder().address(jsonObject.getString("address")).userId(userId)
                .nodeName(nodeName).build();

        address = save(address);

        LndInteraction interaction = LndInteraction.builder().action("v1/newaddress").nodeName(nodeName)
                .request("Empty Request").response(addressResponse.getResponse()).build();

        lndInteractionService.logLndInteraction(interaction);

        return new ApiResponse<>(200, address, "Address creation successful");
    }
}
