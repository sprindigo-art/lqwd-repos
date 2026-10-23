package com.lqwd.service;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.exceptions.ServerErrorException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.HTLCSendReceiveEventLog;
import com.lqwd.model.entities.LspForwardingHistory;
import com.lqwd.model.entities.UserLndChannel;
import com.lqwd.model.enums.ChannelStatus;
import com.lqwd.model.request.OpenChannelRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.OpenChannelResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.repository.HTLCSendReceiveEventLogRepository;
import com.lqwd.repository.LspForwardingHistoryRepository;
import com.lqwd.repository.UserLndChannelRepository;
import com.lqwd.schema.LndTransactionMessage;
import com.lqwd.utils.UserUtil;
import lombok.RequiredArgsConstructor;
import org.apache.commons.codec.binary.Base64;
import org.apache.commons.codec.binary.Hex;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import javax.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class UserLNDChannelService {

    private final LspForwardingHistoryRepository lspForwardingHistoryRepository;
    private final UserLndChannelRepository userLndChannelRepository;
    private final HTLCSendReceiveEventLogRepository htlcSendReceiveEventLogRepository;

    private final Logger logger = LoggerFactory.getLogger(UserLNDChannelService.class);
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final HttpClientToken httpClientToken;
    private final LndHttpClient lndHttpClient;

    private final NodeUtilService nodeUtilService;


    /**
     * With this function we can map the events from active_channel, inactive_channel,
     * fully_resolved_channel to the actual channel.
     *
     * @param base64EncodedTrxid
     * @param index
     * @return
     */
    private String deriveChannelPointFromTrxId(String base64EncodedTrxid, int index) {
        String dd = Hex.encodeHexString(Base64.decodeBase64(base64EncodedTrxid));

        StringBuilder reversedBuilder = new StringBuilder();
        int charIndex = dd.length() - 1;

        //reverse trnxId To derive channel point trx id
        while (charIndex > 0) {
            reversedBuilder.append(dd.charAt(charIndex - 1));
            reversedBuilder.append(dd.charAt(charIndex));
            charIndex -= 2;
        }
        return reversedBuilder + ":" + index;
    }


    public ApiResponse<UserLndChannel> findChannelByNodeNameAndPubkey(String nodeName, String remotePubkey,
                                                           int capacity, OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.
                getAccessTokenFromAuthentication(authentication);

        if (token == null)
            throw new BadRequestException(401, "Couldn't determine user for this request");

        MainResponse userinfo = httpClientToken.userInfo(
                token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());


        UserLndChannel channel = userLndChannelRepository.findChannelByPubKeyAndCapacity(
                userId, nodeName, remotePubkey, true, capacity
        ).orElse(null);

        return new ApiResponse<>(channel, "request success");

    }

    public PageResponse<UserLndChannel> findUserLndChannel(int pageNo, int pageSize,
                                                           String nodeName, String types, String query,
                                                           OAuth2Authentication authentication) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        if (token == null)
            throw new BadRequestException(401, "Couldn't determine user for this request");

        MainResponse userinfo = httpClientToken.userInfo(
                token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());

        List<String> typeList = new ArrayList<>();
        if (!StringUtils.isEmpty(types)) {
            types = types.replaceAll("\\s+", "");
            typeList = Arrays.asList(types.split(","));
        }


        return findUserLndChannel(pageNo, pageSize, nodeName, userId, query, typeList);


    }

    public PageResponse<UserLndChannel> findUserLndChannel(int pageNo, int pageSize,
                                                           String nodeName, String userId, String queryStr, List<String> types) {

        Specification<UserLndChannel> specification = (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (!StringUtils.isEmpty(nodeName))
                predicates.add(builder.like(root.get("nodeName"), nodeName));
            if (!StringUtils.isEmpty(userId))
                predicates.add(builder.like(root.get("userId"), userId));
            if (!types.isEmpty()) {
                predicates.add(root.get("type").in(types));
            }

            if (!StringUtils.isEmpty(queryStr)) {
                Predicate p1 = builder.like(builder.lower(root.get("remotePubKey")),
                        "%" + queryStr.toLowerCase() + "%");
                Predicate p2 = builder.like(builder.lower(root.get("channelPoint")),
                        "%" + queryStr.toLowerCase() + "%");
                Predicate p3 = builder.like(builder.lower(root.get("capacity")),
                        "%" + queryStr.toLowerCase() + "%");
                Predicate p4 = builder.like(builder.lower(root.get("channelId")),
                        "%" + queryStr.toLowerCase() + "%");
                Predicate p5 = builder.like(builder.lower(root.get("txId")),
                        "%" + queryStr.toLowerCase() + "%");
                Predicate p6 = builder.like(builder.lower(root.get("localBalance")),
                        "%" + queryStr.toLowerCase() + "%");
                Predicate p7 = builder.like(builder.lower(root.get("remoteBalance")),
                        "%" + queryStr.toLowerCase() + "%");
                Predicate p8 = builder.like(builder.lower(root.get("closeType")),
                        "%" + queryStr.toLowerCase() + "%");

                predicates.add(builder.or(p1,p2,p3,p4,p5,p6,p7,p8));
            }



            return builder.and(predicates.toArray(new Predicate[predicates.size()]));
        };

        Page<UserLndChannel> channels = userLndChannelRepository
                .findAll(specification, PageRequest.of(pageNo, pageSize, Sort.by(Sort.Direction.DESC,
                        "dateModified")));

        return new PageResponse<>(pageNo, pageSize, channels.getTotalElements(), channels.getContent()
                , channels.getTotalPages());


    }

    private void updateNodeChannel(String nodeName, String channelId) {

        UserLndChannel channel = userLndChannelRepository
                .findByChannelIdAndNodeName(channelId, nodeName).orElse(null);
//        logger.info("Received message from Kafka :: Topic inside line 192 in UserLndChannelService " + nodeName );
        if (channel == null)
            return;

        String token = accessTokenServiceHelper.getClientAccessToken();
//        logger.info("Received message from Kafka :: Topic inside line 197 in UserLndChannelService " + nodeName +"  " + token);
        if (token == null)
            return;
//        logger.info("Received message from Kafka :: Topic inside line 200 in UserLndChannelService " + nodeName +"  " + channelId);
        MainResponse response = httpClientToken.lndNodeInfo(token, nodeName, "/lndnode/getinfo",
                "LndNodeInfo");
        logger.info("Received message from Kafka :: Topic inside line 280 in UserLndChannelService " + nodeName +"  " + response.getObject()
                +" error:" + response.getError());
        if (response.getStatus() != 200)
            return;

        JSONObject jsonData = new JSONObject(response.getObject());
        String nodeAddress = jsonData.getString("privateAddress");
        logger.info("Received message from Kafka :: Topic inside line 209 in UserLndChannelService " + nodeName + " " + nodeAddress );
        try {

            JSONArray channels = getOpenChannelsFromLND(nodeAddress, nodeName);
//            logger.info("Received message from Kafka :: Topic inside line 213 in UserLndChannelService " + nodeName );
            for (int i = 0; i < channels.length(); i++) {

                JSONObject channelObject = channels.getJSONObject(i);
//                logger.info("Received message from Kafka :: Topic inside line 217 in UserLndChannelService " + nodeName);
                if (channelObject.getString("chan_id").equals(channelId)) {
//                    logger.info("Received message from Kafka :: Topic inside line 219 in UserLndChannelService " + nodeName +"  " + channelId);
                    setOpenChannelValuesFromJson(channelObject, channel);
                    userLndChannelRepository.save(channel);
                    logger.info("Received message from Kafka :: Topic inside line 222 in UserLndChannelService " + nodeName +"  " + channel.toString());
                    break;

                }

            }


        } catch (Exception e) {
            logger.info("An error occurred when get opened channels from node");
        }

    }

    public ApiResponse<OpenChannelResponse> openChannel(OpenChannelRequest request,
                                                        OAuth2Authentication authentication)
            throws Exception {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse resp = httpClientToken.authenticate(request.getPassword(), token);

        if (resp.getStatus() != 200)
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Invalid credential");

        //peer node
        if (!nodeUtilService.isNodePeered(request.getPubKey(), request.getNodeAddress(),
                request.getLndname(), request.getPassphrase())) {

            if (!nodeUtilService.peerWithNode(request.getPubKey(), request.getLndname(),
                    request.getNodeAddress(), request.getRemoteAddress(), request.getPassphrase())) {

                logger.info("Failed to peer nodes");
                throw new BadRequestException(400, "An error occurred when pairing nodes, please try again");
            }

        }

        OpenChannelResponse response = nodeUtilService.openChannelToNode(request);

        if(!response.isSuccess())
            throw new BadRequestException(400, response.getError());

        return new ApiResponse<>(response, "request success");

    }

    public ApiResponse syncNodeChannels(OAuth2Authentication authentication, String nodeName) {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);
        MainResponse userinfo = httpClientToken.userInfo(token);

        if (userinfo.getStatus() != 200)
            throw new BadRequestException(400, "Oops! Couldn't determine user for this request");

        String userId = UserUtil.retrieveUserId(userinfo.getObject());
        //if we do not have any lnd in db, then force an update so we make request to lnd node.

        logger.info("Received message from Kafka :: Topic inside line 280 in UserLndChannelService " + nodeName +"  " + token);
        MainResponse response = httpClientToken.lndNodeInfo(token, nodeName, "/lndnode/getinfo",
                "LndNodeInfo");
        logger.info("Received message from Kafka :: Topic inside line 283 in UserLndChannelService " + response.getObject());
        if (response.getStatus() != 200)
            return new ApiResponse<>(response.getStatus(), null, "Cannot handle this request");
        logger.info("Received message from Kafka :: Topic inside line 286 in UserLndChannelService " );
        JSONObject jsonData = new JSONObject(response.getObject());
        String nodeAddress = jsonData.getString("privateAddress");
        logger.info("Received message from Kafka :: Topic inside line 289 in UserLndChannelService " + nodeAddress);
        try {
            logger.info("Received message from Kafka :: Topic inside line 291 in UserLndChannelService " );
            loadOpenChannels(userId, nodeAddress, nodeName);
            logger.info("Received message from Kafka :: Topic inside line 292 in UserLndChannelService " + userId);
            loadClosedChannels(userId, nodeAddress, nodeName);
            logger.info("Received message from Kafka :: Topic inside line 294 in UserLndChannelService ");
        } catch (Exception e) {
            return new ApiResponse(HttpStatus.INTERNAL_SERVER_ERROR.value(), null, e.getMessage());
        }


        return new ApiResponse(200, null,
                "Synchronization successful");
    }

    private void loadOpenChannels(String userId, String nodeAddress, String nodeName) throws Exception {

        JSONArray channels = getOpenChannelsFromLND(nodeAddress, nodeName);

        List<UserLndChannel> channelsToSave = new ArrayList<>();

        for (int i = 0; i < channels.length(); i++) {

            JSONObject channelObject = channels.getJSONObject(i);

            UserLndChannel userLndChannel = handleOpenedChannelEvent(userId, nodeName,
                    "OPEN_CHANNEL", channelObject);

            channelsToSave.add(userLndChannel);

        }

        userLndChannelRepository.saveAll(channelsToSave);

    }

    private JSONArray getOpenChannelsFromLND(String nodeAddress, String nodeName) throws Exception {
        LNDResponse lndResponse;

        try {
            lndResponse = lndHttpClient.getRequestToLndPod("v1/channels",
                    nodeAddress, Optional.empty(), nodeName, null);
        } catch (Exception e) {
            throw new Exception("An unexpected error occurred when communicating with lnd node.");
        }

        return extractChannelsFromChannelsAPI(lndResponse);

    }

    private void loadClosedChannels(String userId, String nodeAddress, String nodeName)
            throws Exception {

        LNDResponse lndResponse;

        try {
            lndResponse = lndHttpClient.getRequestToLndPod("v1/channels/closed",
                    nodeAddress, Optional.empty(), nodeName, null);

        } catch (Exception e) {
            throw new Exception("An unexpected error occurred when communicating with lnd node.");
        }


        JSONArray channels = extractChannelsFromChannelsAPI(lndResponse);

        List<UserLndChannel> channelsToSave = new ArrayList<>();

        for (int i = 0; i < channels.length(); i++) {

            JSONObject channelObject = channels.getJSONObject(i);

            UserLndChannel userLndChannel = handleCloseChannelEvent(userId, nodeName,
                    "CLOSED_CHANNEL", channelObject);

            if (userLndChannel != null) {
                channelsToSave.add(userLndChannel);
            }

        }

        userLndChannelRepository.saveAll(channelsToSave);

    }

    private JSONArray extractChannelsFromChannelsAPI(LNDResponse lndResponse) throws Exception {

        if (lndResponse.getStatus() != 200) {
            logger.info("channel response code is: {}", lndResponse.getStatus());
            throw new Exception("An unexpected error occurred when getting channels.");
        }

        JSONObject channelResponse = new JSONObject(lndResponse.getResponse());
        return channelResponse.getJSONArray("channels");
    }

    private UserLndChannel handleOpenedChannelEvent(String userId, String nodeName,
                                                    String type, JSONObject channelObject) {

        UserLndChannel userLndChannel = userLndChannelRepository
                .findByChannelPointAndNodeName(channelObject.getString("channel_point"), nodeName)
                .orElse(new UserLndChannel());

        setOpenChannelValuesFromJson(channelObject, userLndChannel);

        userLndChannel.setNodeName(nodeName);
        userLndChannel.setUserId(userId);
        userLndChannel.setType(type);

        return userLndChannel;
    }

    private void setOpenChannelValuesFromJson(JSONObject channelObject, UserLndChannel userLndChannel) {
        userLndChannel.setChannelId(channelObject.getString("chan_id"));
        userLndChannel.setChannelPoint(channelObject.getString("channel_point"));
        userLndChannel.setActive(channelObject.getBoolean("active"));
        userLndChannel.setChanStatusFlag(channelObject.getString("chan_status_flags"));
        userLndChannel.setCloseAddress(channelObject.getString("close_address"));
        userLndChannel.setInitiator(channelObject.getBoolean("initiator"));
        userLndChannel.setIsPrivate(channelObject.getBoolean("private"));
        userLndChannel.setNumUpdates(channelObject.getString("num_updates"));
        userLndChannel.setRemotePubKey(channelObject.getString("remote_pubkey"));
        userLndChannel.setStatus(ChannelStatus.OPEN);
        userLndChannel.setCapacity(channelObject.getString("capacity"));
        userLndChannel.setCommitFee(channelObject.getString("commit_fee"));
        userLndChannel.setCommitWeight(channelObject.getString("commit_weight"));
        userLndChannel.setFeePerKw(channelObject.getString("fee_per_kw"));
        userLndChannel.setLocalBalance(channelObject.getString("local_balance"));
        userLndChannel.setPushAmountSat(channelObject.getString("push_amount_sat"));
        userLndChannel.setRemoteBalance(channelObject.getString("remote_balance"));
        userLndChannel.setTotalSatoshisReceived(channelObject.getString("total_satoshis_received"));
        userLndChannel.setTotalSatoshisSent(channelObject.getString("total_satoshis_sent"));
        userLndChannel.setUnsettledBalance(channelObject.getString("unsettled_balance"));
        userLndChannel.setThawHeight(channelObject.getInt("thaw_height"));
    }

    private UserLndChannel handleCloseChannelEvent(String userId, String nodeName, String type, JSONObject closedChannel) {

        UserLndChannel userLndChannel = userLndChannelRepository
                .findByChannelPointAndNodeName(closedChannel.getString("channel_point"), nodeName)
                .orElse(new UserLndChannel());

        if ("FULLY_RESOLVED_CHANNEL".equals(userLndChannel.getType()) ||
                "CLOSED_CHANNEL".equals(userLndChannel.getType())) {
            return null;
        }

        userLndChannel.setStatus(ChannelStatus.CLOSED);
        userLndChannel.setChannelId(closedChannel.getString("chan_id"));
        userLndChannel.setCloseHeight(closedChannel.getInt("close_height"));
        userLndChannel.setClosingTxHash(closedChannel.getString("closing_tx_hash"));
        userLndChannel.setChainHash(closedChannel.getString("chain_hash"));
        userLndChannel.setSettledBalance(closedChannel.getString("settled_balance"));
        userLndChannel.setTimeLockedBalance(closedChannel.getString("time_locked_balance"));
        userLndChannel.setCloseType(closedChannel.getString("close_type"));
        userLndChannel.setChannelPoint(closedChannel.getString("channel_point"));
        userLndChannel.setOpenInitiator(closedChannel.getString("open_initiator"));
        userLndChannel.setCloseInitiator(closedChannel.getString("close_initiator"));
        userLndChannel.setNodeName(nodeName);
        userLndChannel.setUserId(userId);
        userLndChannel.setCapacity(closedChannel.getString("capacity"));
        userLndChannel.setRemotePubKey(closedChannel.getString("remote_pubkey"));
        userLndChannel.setType(type);


        return userLndChannel;


    }


    private UserLndChannel handleActiveChannelEvent(String nodeName, JSONObject transaction) {
        String trxId = transaction.getJSONObject("active_channel").getString("funding_txid_bytes");
        int outputIndex = transaction.getJSONObject("active_channel").getInt("output_index");

        String channelPoint = deriveChannelPointFromTrxId(trxId, outputIndex);

        UserLndChannel userLndChannel = userLndChannelRepository
                .findByChannelPointAndNodeName(channelPoint, nodeName).orElse(null);

        if (userLndChannel == null)
            return null;

        userLndChannel.setActive(true);
        userLndChannel.setType(transaction.getString("type"));
        return userLndChannel;


    }


    private UserLndChannel handleInActiveChannelEvent(String nodeName, JSONObject transaction) {

        String trxId = transaction.getJSONObject("inactive_channel").getString("funding_txid_bytes");
        int outputIndex = transaction.getJSONObject("inactive_channel").getInt("output_index");

        String channelPoint = deriveChannelPointFromTrxId(trxId, outputIndex);

        UserLndChannel userLndChannel = userLndChannelRepository.
                findByChannelPointAndNodeName(channelPoint, nodeName).orElse(null);

        if (userLndChannel == null)
            return null;

        userLndChannel.setActive(false);
        userLndChannel.setType(transaction.getString("type"));

        return userLndChannel;


    }

    private UserLndChannel handleFullyResolvedChannelEvent(String nodeName, JSONObject transaction) {

        String trxId = transaction.getJSONObject("fully_resolved_channel").getString("funding_txid_bytes");
        int outputIndex = transaction.getJSONObject("fully_resolved_channel").getInt("output_index");

        String channelPoint = deriveChannelPointFromTrxId(trxId, outputIndex);

        UserLndChannel userLndChannel = userLndChannelRepository
                .findByChannelPointAndNodeName(channelPoint, nodeName).orElse(null);

        if (userLndChannel == null)
            return null;

        userLndChannel.setActive(false);
        userLndChannel.setType(transaction.getString("type"));

        return userLndChannel;

    }


    public void logChannelEvents(JSONObject transaction, LndTransactionMessage lndTransactionMessage) {

        String userId = lndTransactionMessage.getUsername().toString();
        String nodeName = lndTransactionMessage.getReplyNodeId().toString();

        String type = transaction.getString("type");

        UserLndChannel userLndChannel = null;

        switch (type) {

            case "FULLY_RESOLVED_CHANNEL":
                userLndChannel = handleFullyResolvedChannelEvent(nodeName, transaction);
                break;
            case "INACTIVE_CHANNEL":
                userLndChannel = handleInActiveChannelEvent(nodeName, transaction);
                break;
            case "ACTIVE_CHANNEL":
                userLndChannel = handleActiveChannelEvent(nodeName, transaction);
                break;
            case "CLOSED_CHANNEL":
                userLndChannel = handleCloseChannelEvent(userId, nodeName,
                        type, transaction.getJSONObject("closed_channel"));
                break;
            case "PENDING_OPEN_CHANNEL":
                userLndChannel = handlePendingOpenChannel(userId, nodeName, transaction);
                break;
            case "OPEN_CHANNEL":
                userLndChannel = handleOpenedChannelEvent(userId, nodeName,
                        type, transaction.getJSONObject("open_channel"));
                break;
            default:
                logger.info("Cannot handle channel type of {}", type);

        }

        if (userLndChannel == null)
            return;

        userLndChannelRepository.save(userLndChannel);

    }

    public UserLndChannel handlePendingOpenChannel(String userId, String nodeName, JSONObject transaction) {

        String txId = transaction.getJSONObject("pending_open_channel").getString("txid");
        int outputIndex = transaction.getJSONObject("pending_open_channel").getInt("output_index");

        String derivedChannelPointVal = deriveChannelPointFromTrxId(txId, outputIndex);

        UserLndChannel userLndChannel = userLndChannelRepository
                .findByChannelPointAndNodeName(derivedChannelPointVal, nodeName).orElse(null);

        if (userLndChannel != null) {
            return null;
        }

        userLndChannel = new UserLndChannel();
        userLndChannel.setChannelPoint(derivedChannelPointVal);
        userLndChannel.setNodeName(nodeName);
        userLndChannel.setOutputIndex(outputIndex);
        userLndChannel.setTxId(txId);
        userLndChannel.setUserId(userId);
        userLndChannel.setType(transaction.getString("type"));

        return userLndChannel;
    }

    public void logForwardingHistory(JSONObject jsonObject, String userId, String nodeName) {

        String eventType = jsonObject.getString("event_type");

        if (!eventType.equals("FORWARD") || eventType.equals("UNKNOWN"))
            return;
        if (jsonObject.has("forward_event")) {
            JSONObject forwardHistory = jsonObject.getJSONObject("forward_event")
                    .getJSONObject("info");

            int outgoingAmt = forwardHistory.getInt("outgoing_amt_msat");
            int incomingAmt = forwardHistory.getInt("incoming_amt_msat");
            logger.info("Received message from Kafka :: Topic inside line 603 in UserLndChannelService " + nodeName);
            LspForwardingHistory history = LspForwardingHistory.builder()
                    .userId(userId)
                    .outgoingAmtMsat(outgoingAmt)
                    .incomingAmtMsat(incomingAmt)
                    .feeMsat(incomingAmt - outgoingAmt)
                    .timestampNs(Long.parseLong(jsonObject.getString("timestamp_ns")))
                    .incomingChannelId(jsonObject.getString("incoming_channel_id"))
                    .outgoingChannelId(jsonObject.getString("outgoing_channel_id"))
                    .incomingHtlcId(jsonObject.getString("incoming_htlc_id"))
                    .outgoingHtlcId(jsonObject.getString("outgoing_htlc_id"))
                    .incomingTimeLock(forwardHistory.getLong("incoming_timelock"))
                    .outgoingTimeLock(forwardHistory.getLong("outgoing_timelock"))
                    .nodeName(nodeName).build();
            lspForwardingHistoryRepository.save(history);
        } else {

            logger.info("Received message from Kafka :: Topic inside line 620 in UserLndChannelService " + nodeName +"  " +  jsonObject.toString());

        }
    }


    public void triggerNodeChannelSync(JSONObject jsonObject, String nodeName) {

        String channelId = jsonObject.getString("incoming_channel_id");

        if(channelId.equals("0"))
             channelId = jsonObject.getString("outgoing_channel_id");

        updateNodeChannel(nodeName,channelId);

    }

    public void logHTLCEvents(JSONObject jsonObject, String userId, String nodeName) {

        String eventType = jsonObject.getString("event_type");

        if (eventType.equals("FORWARD") || eventType.equals("UNKNOWN"))
            return;

        if (eventType.equals("SEND") && !jsonObject.has("forward_event"))
            return;


        HTLCSendReceiveEventLog log = new HTLCSendReceiveEventLog();
        log.setTimestampNs(Long.parseLong(jsonObject.getString("timestamp_ns")));
        log.setIncomingChannelId(jsonObject.getString("incoming_channel_id"));
        log.setOutgoingChannelId(jsonObject.getString("outgoing_channel_id"));
        log.setIncomingHtlcId(jsonObject.getString("incoming_htlc_id"));
        log.setOutgoingHtlcId(jsonObject.getString("outgoing_htlc_id"));
        log.setEventType(eventType);
        log.setUserId(userId);
        log.setNodeName(nodeName);


        if (eventType.equals("SEND")) {

            JSONObject forwardHistory = jsonObject.getJSONObject("forward_event")
                    .getJSONObject("info");

            int outgoingAmt = forwardHistory.getInt("outgoing_amt_msat");
            int incomingAmt = forwardHistory.getInt("incoming_amt_msat");

            log.setIncomingTimeLock(forwardHistory.getLong("incoming_timelock"));
            log.setOutgoingTimeLock(forwardHistory.getLong("outgoing_timelock"));
            log.setOutgoingAmtMsat(outgoingAmt);
            log.setIncomingAmtMsat(incomingAmt);
            log.setFeeMsat(0);

        } else {

            JSONObject settle = jsonObject.getJSONObject("settle_event");
            log.setPreImage(settle.getString("preimage"));

        }

        htlcSendReceiveEventLogRepository.save(log);

    }
}
