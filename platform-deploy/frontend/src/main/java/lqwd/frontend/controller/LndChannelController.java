package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.*;
import lqwd.frontend.service.UserService;
import org.json.JSONObject;
import org.json.simple.parser.ParseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.ArrayList;

@Controller
public class LndChannelController {

    private static Logger logger = LoggerFactory.getLogger(LndChannelController.class);

    @Autowired
    private UserService userService;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;

    @Autowired
    HttpClientApiKey httpClientApiKey;

    @Autowired
    private TokenKey tokenKey;

    //lnd channels - ability to create channel and see already existing channels if any exist
    @RequestMapping(value = "/lnd-channels", method = RequestMethod.GET)
    public ModelAndView lndChannelView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();
        User user = new User();

        tokenKey = userService.getSessionInfo(request, session);

        user = httpClientToken.checkUser(tokenKey);

        if (user == null || user.getEmail() == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), userService.getSessionLnd(session));

        String channels_content = httpClientLnd.getChannelsFromDB(tokenKey.getAccess_token(), session.getAttribute("lnd").toString(), null, String.valueOf(100), "ACTIVE_CHANNEL,INACTIVE_CHANNEL,OPEN_CHANNEL");
        ArrayList<LndChannel> channels = new ArrayList<>();
        if(channels_content != null){
            channels = new LndChannel().mapLndChannels(channels_content);
        }

        //get pending channels
        String pending_content = httpClientLnd.getChannelsFromDB(tokenKey.getAccess_token(), session.getAttribute("lnd").toString(), null, String.valueOf(100), "PENDING_OPEN_CHANNEL");
        ArrayList<LndPendingChannel> lndPendingChannels = new ArrayList<>();
        if (pending_content != null && httpClientLnd.isJson(pending_content)){
            LndPendingChannel lndPendingChannel = new LndPendingChannel();
            lndPendingChannels = lndPendingChannel.mapContentList(pending_content);
        }
        //get closed channels
        String closed_content = httpClientLnd.getChannelsFromDB(tokenKey.getAccess_token(), session.getAttribute("lnd").toString(), null, String.valueOf(100), "CLOSED_CHANNEL,FULLY_RESOLVED_CHANNEL");
        logger.info(closed_content);
        ArrayList<LndClosedChannel> lndClosedChannels = new ArrayList<>();
        if (closed_content != null && httpClientLnd.isJson(closed_content)){
            LndClosedChannel lndClosedChannel = new LndClosedChannel();
            lndClosedChannels =  lndClosedChannel.mapContentList(closed_content);
            logger.info(lndClosedChannels.toString());
        }

        //get existing lnd channels both active and pending
        modelAndView.addObject("user", user);
        modelAndView.addObject("channels",channels);
        modelAndView.addObject("pendingChannels",lndPendingChannels);
        modelAndView.addObject("closedChannels",lndClosedChannels);

        modelAndView.setViewName("lnd_channels/lnd_channels");

        return modelAndView;
    }

    @RequestMapping(value = "/open-lnd-channel", method = RequestMethod.GET)
    public ModelAndView lndOpenChannelView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, ParseException {

        ModelAndView modelAndView = new ModelAndView();
        User user = new User();

        tokenKey = userService.getSessionInfo(request, session);

        user = httpClientToken.checkUser(tokenKey);

        if (user == null || user.getEmail() == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        String lnd_name = userService.getSessionLnd(session);
        if (lnd_name == null){
            return new ModelAndView("redirect:/profile");
        }

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);
        if(lndNode != null) {
            logger.info(lndNode.toString());
            if (lndNode.getIsNonCustodial() != null) {
                modelAndView.addObject("is_non_custodial", lndNode.getIsNonCustodial() ? "1" : "0");
            }
        }

        if(lndNode.getLndNodeName() != null) {
            String contentWallet = httpClientLnd.getLndNodeWalletBalance(tokenKey.getAccess_token(), lndNode.getLndNodeName());
            logger.info("contentWallet: " + contentWallet);
            if (contentWallet != null && contentWallet.contains("total_balance")) {
                WalletBalance walletBalance = new WalletBalance();
                walletBalance = walletBalance.mapContent(contentWallet);
                lndNode.setWalletBalance(walletBalance);
            }
        }

        //get lqwd nodes from json
        ArrayList<LndNode> lqwdNodes = new LndNode().lqwdNodes();
        logger.info(String.valueOf(lqwdNodes));
        if (lqwdNodes != null){
            modelAndView.addObject("lqwdNodes", lqwdNodes);
        }
        //get existing lnd channels both active and pending
        modelAndView.addObject("lndNodeSession",lndNode);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_channels/create_channel");

        return modelAndView;
    }

    //get lnd channels and fragments for deploying with ajax
    @RequestMapping(value = "/get-active-channels", method = RequestMethod.GET)
    public ModelAndView getActiveChannels(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        User user = new User();

        tokenKey = userService.getSessionInfo(request, session);

        user = httpClientToken.checkUser(tokenKey);

        if (user == null || user.getEmail() == null) {
            userService.removeSessionInfo(response, session);
            return null;
        }

        //get lnd channels
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());

        if (lndNodes != null) {
            for (LndNode lndNode : lndNodes) {
                if (lndNode.getStatus().equals("RUNNING")) {
                    ArrayList<LndChannel> activeChannels = new ArrayList<>();
                    ArrayList<LndChannel> tmp_lndChannels = httpClientLnd.getLndChannelList(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                    if (tmp_lndChannels != null) {
                        for (LndChannel lndChannel : tmp_lndChannels) {
                            if (lndChannel.isActive()) {
                                activeChannels.add(lndChannel);
                            }
                        }
                    }

                    lndNode.setActiveChannels(activeChannels);
                }
            }
        }
        modelAndView.addObject("lndNodes", lndNodes);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_channels/fragments/lnd_channel_card::lnd_active_channels");

        return modelAndView;
    }

    @RequestMapping(value = "/get-inactive-channels", method = RequestMethod.GET)
    public ModelAndView getInactiveChannels(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        User user = new User();

        tokenKey = userService.getSessionInfo(request, session);

        user = httpClientToken.checkUser(tokenKey);

        if (user == null || user.getEmail() == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        //get lnd channels
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());

        if (lndNodes != null) {
            for (LndNode lndNode : lndNodes) {
                if (lndNode.getStatus().equals("RUNNING")) {
                    ArrayList<LndChannel> inactiveChannels = new ArrayList<>();
                    ArrayList<LndChannel> tmp_lndChannels = httpClientLnd.getLndChannelList(tokenKey.getAccess_token(), lndNode.getLndNodeName());

                    if (tmp_lndChannels != null) {
                        for (LndChannel lndChannel : tmp_lndChannels) {
                            if (!lndChannel.isActive()) {
                                inactiveChannels.add(lndChannel);
                            }
                        }
                    }

                    lndNode.setClosedChannels(inactiveChannels);
                }
            }
        }
        modelAndView.addObject("lndNodes", lndNodes);

//        logger.info(user.getCurrency());
//        logger.info(String.valueOf(totalReceived));
//        logger.info(String.valueOf(totalSent));
//        logger.info(String.valueOf(totalWalletBalance));
//
//        modelAndView.addObject("totalbalance", totalWalletBalance);
//        modelAndView.addObject("totalReceived", totalReceived);
//        modelAndView.addObject("totalSent", totalSent);

        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_channels/fragments/lnd_channel_card::lnd_inactive_channels");

        return modelAndView;

    }

    @RequestMapping(value = "/get-pending-channels", method = RequestMethod.GET)
    public ModelAndView getPendingChannels(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        User user = new User();

        tokenKey = userService.getSessionInfo(request, session);

        user = httpClientToken.checkUser(tokenKey);

        if (user == null || user.getEmail() == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        //get lnd channels
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        logger.info(lndNodes.toString());
        if (lndNodes != null) {
            for (LndNode lndNode : lndNodes) {
                if (lndNode.getStatus().equals("RUNNING")) {
                    String tmp_pendingChannels =  httpClientLnd.getPendingLndChannelList(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                    if (tmp_pendingChannels != null) {
                        lndNode.setPendingChannels(lndNode.mapPendingLndChannels(tmp_pendingChannels));
                    }
                }
            }
        }

        modelAndView.addObject("lndNodes", lndNodes);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_channels/fragments/lnd_channel_card::lnd_pending_channels");

        return modelAndView;

    }

    //create channel
    @RequestMapping(value = "/create-channel", method = RequestMethod.POST)
    public Object createChannel(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                @RequestParam("node_key") String node_key, @RequestParam("local_fund_amnt") String local_fund_amnt,
                                @RequestParam(value = "hostname", required = false) String hostname,
                                @RequestParam(value = "password") String password, @RequestParam(value = "passphrase", required = false) String passphrase,
                                @RequestParam(value = "port", required = false) String port,
                                @RequestParam(value = "sat_per_vbyte", defaultValue = "1", required = false) String sat_per_vbyte,
                                @RequestParam(value = "min_htlc", defaultValue = "1", required = false) String min_htlc,
                                @RequestParam(value = "private", defaultValue = "false", required = false) String private_chan) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);
        String content = null;
        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else{
            user.setPassword(password);
            tokenKey = httpClientToken.getToken(user, tokenKey);
            if (tokenKey.getAccess_token() == null){
                userService.removeSessionInfo(response, session);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "400").put("message", "Failed to Authenticate, Password Incorrect");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        String lnd_name = userService.getSessionLnd(session);
        if(hostname.equals("") || port.equals("")){
            ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
            ArrayList<Peer> peers = new ArrayList<>();
            Peer peer = new Peer();
            for (LndNode lndNode: lndNodes) {
                String peer_content = httpClientLnd.getPeers(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                if (peer_content != null){
                    ArrayList<Peer> peers_tmp = peer.mapPeerListContent(peer_content, lndNode.getLndNodeName());
                    if (peers_tmp != null){
                        peers.addAll(peers_tmp);
                    }
                }
            }
            boolean connectedToPeer =false;
            for(Peer peer1:peers){
                if (peer1.getPub_key().equals(node_key)){
                    connectedToPeer = true;
                    content = httpClientLnd.createLNDChannel(tokenKey.getAccess_token(), lnd_name, node_key, local_fund_amnt, passphrase,
                            sat_per_vbyte, Integer.parseInt(min_htlc), null);
                    break;
                }
            }
            if(!connectedToPeer){
                JSONObject jsonObj = new JSONObject();
                jsonObj.put("status", "400").put("message", "Node must be connected to peer first, please provide the hostname and port number");
                return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
            }
        } else {
            //check if connected to peer
            httpClientLnd.connectToPeer(tokenKey.getAccess_token(), lnd_name, node_key, hostname, port, passphrase);
            content = httpClientLnd.createLNDChannel(tokenKey.getAccess_token(), lnd_name, node_key, local_fund_amnt, passphrase,
                    sat_per_vbyte, Integer.parseInt(min_htlc), null);
        }

        if (content != null && httpClientLnd.isJson(content)) {
            JSONObject jsonObject1 = new JSONObject(content);
            logger.info(jsonObject1.toString());
            if (jsonObject1.has("status") && jsonObject1.get("status").equals(200)) {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Successful Created Channel");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            } else if (jsonObject1.has("error") && !jsonObject1.get("error").equals("")) {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", 400).put("message", jsonObject1.get("error").toString());
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            } else if (jsonObject1.has("message") && !jsonObject1.get("message").equals("")) {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", 400).put("message", jsonObject1.get("message").toString());
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            } else if (jsonObject1.has("funding_txid_bytes") && jsonObject1.get("funding_txid_bytes") != null) {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Successful Created Channel");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Create Channel");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "400").put("message", "Failed to Create Channel");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

    }

    //get channel details view
    @RequestMapping(value = "/channel-details", method = RequestMethod.POST)
    public Object getChannelDetails(@RequestParam("channel") String channel_content,
                                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        logger.info(channel_content.toString());

        LndChannel channel = new LndChannel();
        channel = channel.mapContent(channel_content);
        logger.info(channel.toString());
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setCurrency(userService.getSessionCurrency(session));

        String lnd_name = userService.getSessionLnd(session);

        if (lnd_name != null) {
            LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);
            LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), lnd_name);
            if (lndNodeInfo != null) {
                lndNode.setLndNodeInfo(lndNodeInfo);
            }
            modelAndView.addObject("lndNode", lndNode);
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "Failed to get LND Name from Session").put("error", true);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        String remoteNodeInfo = httpClientLnd.getNodeInfo(tokenKey.getAccess_token(), lnd_name, channel.getRemote_pubkey());
        logger.info(remoteNodeInfo);
        LndNode remoteNode = new LndNode();
        if (remoteNodeInfo != null && httpClientLnd.isJson(remoteNodeInfo)){
            remoteNode = remoteNode.mapNodeInfo(remoteNodeInfo);
            logger.info(remoteNode.toString());
        }

        modelAndView.addObject("remoteNode", remoteNode);
        modelAndView.addObject("lndChannel", channel);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_channels/modals/lnd_channel_details_modal");
        return modelAndView;

    }

    //get update channel view
    @RequestMapping(value = "/update-channel-view", method = RequestMethod.POST)
    public ModelAndView updateChannelModalView(@RequestParam("channel") String channel_content,
                                               HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        logger.info(channel_content.toString());

        LndChannel channel = new LndChannel();
        channel = channel.mapContent(channel_content);
        logger.info(channel.toString());
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setCurrency(userService.getSessionCurrency(session));

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));
        LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));

        if (lndNodeInfo != null) {
            lndNode.setLndNodeInfo(lndNodeInfo);
        }

        modelAndView.addObject("lndChannel", channel);
        modelAndView.addObject("lndNode", lndNode);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_channels/modals/lnd_update_channel_modal");
        return modelAndView;

    }


    //update channel policy
    @RequestMapping(value = "/update-channel-policy", method = RequestMethod.POST)
    public Object updateChanPolicy(@RequestParam("channel_point") String channel_point,
                                   @RequestParam(value = "base_fee_msat", defaultValue = "", required = false) String base_fee_msat,
                                   @RequestParam(value = "fee_rate_ppm", defaultValue = "", required = false) String fee_rate_ppm,
                                   @RequestParam(value = "min_htlc_msat", defaultValue = "", required = false) String min_htlc_msat,
                                   @RequestParam(value = "max_htlc_msat", defaultValue = "", required = false) String max_htlc_msat,
                                   @RequestParam(value = "time_lock_delta", defaultValue = "40", required = false) String time_lock_delta,
                                   @RequestParam("password") String password,
                                   @RequestParam(value = "passphrase", required = false) String passphrase,
                                   HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else{
            user.setPassword(password);
            tokenKey = httpClientToken.getToken(user, tokenKey);
            if (tokenKey.getAccess_token() == null){
                userService.removeSessionInfo(response, session);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "400").put("message", "Failed to Authenticate, Password Incorrect");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        String lnd_name = userService.getSessionLnd(session);

        String content = httpClientLnd.updateChannelPolicy(tokenKey.getAccess_token(), lnd_name, channel_point, passphrase,
                base_fee_msat, fee_rate_ppm, min_htlc_msat, max_htlc_msat, time_lock_delta);

        logger.info(content);
        if (content != null && httpClientLnd.isJson(content)) {
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("status") && !jsonObject.get("status").equals(200)) {
                logger.info(content);
                JSONObject jsonObjectToJs = new JSONObject(content);
                jsonObjectToJs.put("status", "400").put("message", "Failed to Update Channel").put("error", jsonObjectToJs.get("error"));
                return new ResponseEntity<>(jsonObjectToJs.toString(), HttpStatus.BAD_REQUEST);
            } else {
                return new ResponseEntity<>(content, HttpStatus.OK);
            }
        } else {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "200").put("message", "Successfully to Close Channel");
            return new ResponseEntity<>(content, HttpStatus.OK);
        }
    }

    //close channel
    @RequestMapping(value = "/close-channel", method = RequestMethod.POST)
    public Object closeLndChannel(@RequestParam(value = "channel_point") String channel_point,
                                  @RequestParam(value = "lnd_name") String lnd_name,
                                  @RequestParam(value = "password") String password,
                                  @RequestParam(value = "passphrase", required = false) String passphrase,
                                  HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else{
            user.setPassword(password);
            tokenKey = httpClientToken.getToken(user, tokenKey);
            if (tokenKey.getAccess_token() == null){
                userService.removeSessionInfo(response, session);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "400").put("message", "Failed to Authenticate, Password Incorrect");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }


        String content = httpClientLnd.closeChannel(tokenKey.getAccess_token(), lnd_name, channel_point, passphrase, false);

        if (content != null && httpClientLnd.isJson(content)) {
            JSONObject jsonObject = new JSONObject(content);
            if (!jsonObject.get("status").equals(200)) {
                logger.info(content);
                JSONObject jsonObjectToJs = new JSONObject(content);
                jsonObjectToJs.put("status", "400").put("message", "Failed to Close Channel");
                return new ResponseEntity<>(jsonObjectToJs.toString(), HttpStatus.BAD_REQUEST);
            } else {
                return new ResponseEntity<>(content, HttpStatus.OK);
            }
        } else {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "200").put("message", "Successfully to Close Channel");
            return new ResponseEntity<>(content, HttpStatus.OK);
        }
    }

    //close inactive channel
    @RequestMapping(value = "/close-inactive-channel", method = RequestMethod.POST)
    public Object closeLndInactiveChannel(@RequestParam(value = "channel_point") String channel_point,
                                          @RequestParam(value = "lnd_name") String lnd_name,
                                          @RequestParam(value = "password") String password,
                                          @RequestParam(value = "passphrase", required = false) String passphrase,
                                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else{
            user.setPassword(password);
            tokenKey = httpClientToken.getToken(user, tokenKey);
            if (tokenKey.getAccess_token() == null){
                userService.removeSessionInfo(response, session);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "400").put("message", "Failed to Authenticate, Password Incorrect");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }

        String content = httpClientLnd.closeChannel(tokenKey.getAccess_token(), lnd_name, channel_point, passphrase, true);

        if (content != null && httpClientLnd.isJson(content)) {
            JSONObject jsonObject = new JSONObject(content);
            if (!jsonObject.get("status").equals(200)) {
                JSONObject jsonObjectResponse = new JSONObject();
                jsonObjectResponse.put("status", jsonObject.get("status")).put("message", jsonObject.get("message"));
                return new ResponseEntity<>(jsonObjectResponse.toString(), HttpStatus.BAD_REQUEST);
            } else {
                JSONObject jsonObjectResponse = new JSONObject();
                jsonObjectResponse.put("status", "200").put("message", "Channel was closed Successfully");
                return new ResponseEntity<>(jsonObjectResponse.toString(), HttpStatus.OK);
            }
        } else {
            JSONObject jsonObjectResponse = new JSONObject();
            jsonObjectResponse.put("status", "400").put("message", "The error occurs while closing channel");
            return new ResponseEntity<>(jsonObjectResponse.toString(), HttpStatus.BAD_REQUEST);
        }
    }
    //sync channels
    @RequestMapping(value = "/sync-channels", method = RequestMethod.GET)
    public Object syncChannels(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        String lnd_name = userService.getSessionLnd(session);
        content = httpClientLnd.syncChannels(tokenKey.getAccess_token(), lnd_name);

        if (content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("status") && jsonObject.get("status").equals(200)) {
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }else{
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "Failed to Sync Channels");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
    }


    //close-channel popup view
    @RequestMapping(value = "/close-channel-popup", method = RequestMethod.POST)
    public ModelAndView closeChannelPopup(@RequestParam(value = "channel") String channel_content,
                                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        logger.info(channel_content.toString());

        LndChannel channel = new LndChannel();
        channel = channel.mapContent(channel_content);
        logger.info(channel.toString());
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setCurrency(userService.getSessionCurrency(session));

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));

        modelAndView.addObject("lndChannel", channel);
        modelAndView.addObject("lndNode", lndNode);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_channels/modals/close-channel-popup");
        return modelAndView;

    }
}
