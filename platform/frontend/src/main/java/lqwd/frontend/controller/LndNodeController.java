package lqwd.frontend.controller;

import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.*;
import lqwd.frontend.service.UserService;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.lang.reflect.Field;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Optional;


@Controller
public class LndNodeController {

    private static Logger logger = LoggerFactory.getLogger(LndNodeController.class);

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

    //main node dashboard to create a node and channels
    @RequestMapping(value = "/lnd-node", method = RequestMethod.GET)
    public ModelAndView lndNodeView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, URISyntaxException {

        ModelAndView modelAndView = new ModelAndView();
        User user = new User();

        tokenKey = userService.getSessionInfo(request, session);

        user = httpClientToken.checkUser(tokenKey);

        if (user == null || user.getEmail() == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setCurrency(userService.getSessionCurrency(session));
        WalletBalance walletBalance = new WalletBalance();
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());

        if (lndNodes == null) {
            user.setLndNodes(null);
        } else {
            user.setLndNodes(lndNodes);
        }


        modelAndView.addObject("lndNodes", lndNodes);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_dashboard/lnd_dashboard");
        return modelAndView;
    }

    @RequestMapping(value = "/create-node", method = RequestMethod.POST)
    public Object createNode(@RequestParam("password") String password,
                             @RequestParam("network") String network,
                             @RequestParam("routing") String routing,
                             @RequestParam("breez") String breez,
                             @RequestParam(value = "passphrase", required = false) String passphrase,
                             @RequestParam(value = "keySend", required = false, defaultValue = "false") Boolean keySend,
                             @RequestParam(defaultValue = "lqwd-lnd", value = "alias") String alias,
                             HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        LndNode lndNode = new LndNode();

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 403).put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.FORBIDDEN);
        }

        String content = null;

        //if non custodial wallet will require passphrase but assume in no passphrase is given then must be custodial wallet
        if(passphrase == null) {
            if (Boolean.valueOf(routing)) {
                content = httpClientLnd.createRoutingNode(tokenKey.getAccess_token(), user.getUsername(), password, network, breez, alias, null, keySend);
            } else {
                content = httpClientLnd.createPersonalLNDNode(tokenKey.getAccess_token(), user.getUsername(), password, network, breez, alias, null, keySend);
            }
        }else{
            if (Boolean.valueOf(routing)) {
                content = httpClientLnd.createRoutingNode(tokenKey.getAccess_token(), user.getUsername(), password, network, breez, alias, passphrase, keySend);
            } else {
                content = httpClientLnd.createPersonalLNDNode(tokenKey.getAccess_token(), user.getUsername(), password, network, breez, alias, passphrase, keySend);
            }
        }

        if (content != null && httpClientLnd.isJson(content)) {

            JSONObject jsonObject_statusCheck = new JSONObject(content);
            if (jsonObject_statusCheck.has("status") && !jsonObject_statusCheck.get("status").equals(200)){
                JSONObject jsonObject = new JSONObject();
                return new ResponseEntity<>(jsonObject_statusCheck.toString(), HttpStatus.BAD_REQUEST);
            }
            lndNode = lndNode.mapContent(content);

            if (lndNode != null) {
                userService.saveSessionInfo(response, session, tokenKey, user.getCurrency(), null);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Successful Created Node");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            } else {
                JSONObject jsonObject_check = new JSONObject(content);
                JSONObject jsonObject = new JSONObject();
                if(jsonObject_check.has("status") && jsonObject_check.get("status").equals(200)){
                    if (jsonObject_check.has("object") && !jsonObject_check.isNull("object")) {
                        jsonObject.put("status", "400").put("message", jsonObject_check.getString("object"));
                        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
                    }
                }
                String errorMessage = "There was an issue while creating the node. Please try again later";
                logger.info(jsonObject_check.toString());
                if(jsonObject_check.has("error") && !jsonObject_check.isNull("error")){
                    errorMessage = jsonObject_check.getString("error");
                }
                if(jsonObject_check.has("message") && !jsonObject_check.isNull("message")){
                    errorMessage = jsonObject_check.getString("message");
                }
                jsonObject.put("status", "400").put("message", errorMessage);
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }

        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "400").put("message", "Failed to Create Node");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

    }

    @RequestMapping(value = "/get-node-list", method = RequestMethod.GET)
    public Object getNodeListFragment(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, URISyntaxException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 403).put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.FORBIDDEN);
        }

        user.setCurrency(userService.getSessionCurrency(session));

        //get lnd channels
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());

        WalletBalance walletBalance = new WalletBalance();

        if (lndNodes != null) {
            user.setLndNodes(lndNodes);
            for (LndNode lndNode : lndNodes) {
                LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                if (!lndNode.getIsConfirmed() && lndNode.getIsNonCustodial()){
                    httpClientLnd.setConfirmed(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                }
                if (lndNodeInfo != null) {
                    lndNode.setLndNodeInfo(lndNodeInfo);
                    if (lndNode.getStatus().equalsIgnoreCase("RUNNING")) {
                        String contentWallet = httpClientLnd.getLndNodeWalletBalance(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                        if(contentWallet != null && contentWallet.contains("total_balance")){
                            walletBalance = walletBalance.mapContent(contentWallet);
                            lndNode.setWalletBalance(walletBalance);
                            if (user.getCurrency().equals("bitcoin")) {
                                lndNode.getWalletBalance().setTotal_balance((long) (lndNode.getWalletBalance().getTotal_balance()*Math.pow(10, -8)));
                            } else if (user.getCurrency().equals("CAD") || user.getCurrency().equals("USD")) {
                                BitcoinPrice bitcoinPrice = userService.getBTCPrice();
                                if (bitcoinPrice != null) {
                                    if (user.getCurrency().equals("CAD")) {
                                        lndNode.getWalletBalance().setTotal_balance((long) (lndNode.getWalletBalance().getTotal_balance()*Math.pow(10, -8)* bitcoinPrice.getCad()));
                                    } else {
                                        lndNode.getWalletBalance().setTotal_balance((long) (lndNode.getWalletBalance().getTotal_balance()*Math.pow(10, -8)* bitcoinPrice.getUsd()));
                                    }

                                }
                            }
                        }
                    }
                }
            }
        }

        modelAndView.addObject("lndNodes", lndNodes);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_dashboard/fragments/lnd_node_card");
        return modelAndView;
    }

    @RequestMapping(value = "/lnd-details", method = RequestMethod.GET)
    public ModelAndView getLndNodeDetails(@RequestParam(value = "lnd_name", required = false) String lnd_name,
                                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        user.setCurrency(userService.getSessionCurrency(session));
        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);

        LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), lnd_name);
        if (lndNodeInfo != null) {
            lndNode.setLndNodeInfo(lndNodeInfo);
        }

        if (lndNodeInfo != null) {
            lndNode.setLndNodeInfo(lndNodeInfo);
        }

        if (lndNode.getLndNodeInfo().getAlias() == null) {
            return new ModelAndView("redirect:/lnd-node");
        }
        modelAndView.addObject("lndNode", lndNode);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_node/lnd_node-details");

        return modelAndView;

    }

    @RequestMapping(value = "/manage-nodes", method = RequestMethod.GET)
    public ModelAndView getManageNodesView(@RequestParam(value = "lnd_name", required = false) String lnd_name, HttpSession session,
                                           HttpServletRequest request, HttpServletResponse response) throws IOException, URISyntaxException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setLndNodes(httpClientLnd.getLndNodeList(tokenKey.getAccess_token()));
        modelAndView.addObject("lndNodes", user.getLndNodes());
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_node/manage_nodes");
        return modelAndView;
    }

    @RequestMapping(value = "/get-lnd-node-list", method = RequestMethod.GET)
    public ModelAndView getManageLndNodeList(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        user.setLndNodes(httpClientLnd.getLndNodeList(tokenKey.getAccess_token()));

        for (LndNode lndNode: user.getLndNodes()) {
            if (!lndNode.getIsConfirmed()){
                httpClientLnd.setConfirmed(tokenKey.getAccess_token(), lndNode.getLndNodeName());
            }
        }
        modelAndView.addObject("lndNodes", user.getLndNodes());
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_node/fragments/manage_lnd_node_card");

        return modelAndView;
    }

    @RequestMapping(value = "/get-manage-node-details", method = RequestMethod.GET)
    public ModelAndView getManageNodeDetails(@RequestParam("lnd_name") String lnd_name, HttpSession session, HttpServletRequest request,
                                             HttpServletResponse response) throws IOException, URISyntaxException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        user.setCurrency(userService.getSessionCurrency(session));
        WalletBalance walletBalance = new WalletBalance();
        user.setLndNodes(httpClientLnd.getLndNodeList(tokenKey.getAccess_token()));
        LndNode lndNode = new LndNode();
        for (LndNode lndNode_tmp: user.getLndNodes()) {
            if (lndNode_tmp.getLndNodeName().equals(lnd_name)){
                LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), lnd_name);
                if (lndNodeInfo != null) {
                    lndNode_tmp.setLndNodeInfo(lndNodeInfo);
                    lndNode = lndNode_tmp;
                    if (lndNode.getStatus().equalsIgnoreCase("RUNNING")) {
                        try{
                            String contentWallet = httpClientLnd.getLndNodeWalletBalance(tokenKey.getAccess_token(), lndNode.getLndNodeName());

                            walletBalance = walletBalance.mapContent(contentWallet);
                            if (walletBalance != null) {
                                lndNode.setWalletBalance(walletBalance);

                                if (user.getCurrency().equals("bitcoin")) {
                                    lndNode.getWalletBalance().setTotal_balance((long) (lndNode.getWalletBalance().getTotal_balance() * Math.pow(10, -8)));
                                } else if (user.getCurrency().equals("CAD") || user.getCurrency().equals("USD")) {
                                    BitcoinPrice bitcoinPrice = userService.getBTCPrice();
                                    if (bitcoinPrice != null) {
                                        if (user.getCurrency().equals("CAD")) {
                                            lndNode.getWalletBalance().setTotal_balance((long) (lndNode.getWalletBalance().getTotal_balance() * Math.pow(10, -8) * bitcoinPrice.getCad()));
                                        } else {
                                            lndNode.getWalletBalance().setTotal_balance((long) (lndNode.getWalletBalance().getTotal_balance() * Math.pow(10, -8) * bitcoinPrice.getUsd()));
                                        }
                                    }
                                }
                            }
                        }catch(org.json.JSONException ex){
                            ex.printStackTrace();
                            logger.info(ex.getMessage(), ex);
                        }
                    }
                }
                break;
            }
        }
        modelAndView.addObject("lndNode", lndNode);
        modelAndView.addObject("user", user);
        if (lndNode.getLndNodeInfo().getAlias() == null) {
            modelAndView.setViewName("lnd_node/fragments/manage_node-details-error");
        } else {
            modelAndView.setViewName("lnd_node/fragments/manage_node-details");
        }

        return modelAndView;
    }

    @RequestMapping(value = "/close-lnd-node", method = RequestMethod.POST)
    public Object closeLndNodeReq(@RequestParam(value = "lnd_name") String lnd_name,
                                  @RequestParam(value = "password") String password,
                                  @RequestParam(value = "force") boolean force,
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
        //check wallet balance
        try {
            String walletCheck = httpClientLnd.getLndNodeWalletBalance(tokenKey.getAccess_token(), lnd_name);
            if (walletCheck != null && httpClientLnd.isJson(walletCheck)) {
                WalletBalance walletBalance = new WalletBalance();
                walletBalance = walletBalance.mapContent(walletCheck);
                if (walletBalance != null && walletBalance.getTotal_balance() > 0) {
                    JSONObject jsonObject = new JSONObject();
                    jsonObject.put("status", "400").put("message", "Cannot Destroy Nodes with Funds on them");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

                }
            }
        }catch(JSONException ex){
            logger.info(ex.getMessage(),ex);
        }

        String content = null;
        content = httpClientLnd.closeLndNode(tokenKey.getAccess_token(), lnd_name, user.getUsername(), password, force);
        logger.info(content);
        if (content != null && httpClientLnd.isJson(content)) {
            JSONObject jsonContent = new JSONObject(content);
            if (jsonContent.get("status").equals(200)) {
                return new ResponseEntity<>(jsonContent.toString(), HttpStatus.OK);
            } else {
                return new ResponseEntity<>(jsonContent.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "400").put("message", "Failed to Destroy Node");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
    }

    @RequestMapping(value = "/lnd-address", method = RequestMethod.GET)
    public ModelAndView lndAddressesView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        String lnd_name = userService.getSessionLnd(session);
        if (lnd_name != null){
            LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);
            if (lndNode != null) {
                if (lndNode.getStatus().equalsIgnoreCase("RUNNING")) {
                    String contentWallet = httpClientLnd.getLndNodeWalletBalance(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                    logger.info(contentWallet);
                    if (contentWallet != null && contentWallet.contains("total_balance")) {
                        WalletBalance walletBalance = new WalletBalance();
                        walletBalance = walletBalance.mapContent(contentWallet);
                        lndNode.setWalletBalance(walletBalance);
                    }
                }
                modelAndView.addObject("lndNode", lndNode);
            }else{
                userService.setSessionLnd(session, null);
                return new ModelAndView("redirect:/profile");
            }
        }else{
            return new ModelAndView("redirect:/profile");
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_address/lnd-address");
        return modelAndView;
    }

    @RequestMapping(value = "/get-addresses-list", method = RequestMethod.GET)
    public Object getAddressesList(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        String lnd_name = userService.getSessionLnd(session);
        if (lnd_name == null) {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Get LND Name from Session");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        String content = httpClientLnd.getAllAddressesByLnd(tokenKey.getAccess_token(), lnd_name);
        if (content != null && httpClientLnd.isJson(content)) {
            LndAddress lndAddress = new LndAddress();
            ArrayList<LndAddress> lndAddresses = new ArrayList<>();
            lndAddresses = lndAddress.mapListAddress(content);
            if (lndAddresses != null) {
                modelAndView.addObject("lndAddresses", lndAddresses);
            }
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_address/fragments/address_list");
        return modelAndView;
    }

    @RequestMapping(value = "/create-address", method = RequestMethod.POST)
    public Object createAddress(
                                @RequestParam("password") String password,
                                @RequestParam(value = "passphrase", required = false) String passphrase,
                                HttpSession session, HttpServletRequest request, HttpServletResponse response) throws Exception {

        tokenKey = userService.getSessionInfo(request, session);

        //check password
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
        if(lnd_name == null) {
        	JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Please select a node");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        
        String content = httpClientLnd.createAddress(tokenKey.getAccess_token(), lnd_name, passphrase);

        if (content == null) {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Unable to Create Wallet Address");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if (httpClientLnd.isJson(content)) {
            JSONObject jsonObject_content = new JSONObject(content);
            JSONObject json_resonse = new JSONObject();
            if (jsonObject_content.has("data") && jsonObject_content.get("data") != null) {
                JSONObject jsonTemp = jsonObject_content.getJSONObject("data");
                json_resonse.put("status", "200").put("message", jsonObject_content.get("message")).put("address", jsonTemp.get("address"));
                return new ResponseEntity<>(json_resonse.toString(), HttpStatus.OK);
            }
        }
        JSONObject json = new JSONObject();
        json.put("status", "400").put("message", "Failed to create an address!");
        return new ResponseEntity<>(json.toString(), HttpStatus.BAD_REQUEST);
    }

    @RequestMapping(value = "/get-address-qrcode", method = RequestMethod.GET)
    public Object getAddressQrCode(@RequestParam("address") String address, HttpSession session, HttpServletRequest request, HttpServletResponse response) throws Exception {
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        BitMatrix bitMatrix = userService.generateAddressQrCode(address);

        ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream();
        MatrixToImageWriter.writeToStream(bitMatrix, "png", byteArrayOutputStream);
        byteArrayOutputStream.close();

        return new ResponseEntity<>(Base64.getEncoder().encode(byteArrayOutputStream.toByteArray()), HttpStatus.OK);
    }

    @RequestMapping(value = "/get-wallet-balance", method = RequestMethod.GET)
    public ModelAndView getWalletBalance(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, URISyntaxException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return null;
        }

        user.setCurrency(userService.getSessionCurrency(session));

        long totalWalletBalance = 0L;
        long totalReceived = 0L;
        long totalSent = 0L;

        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        if (lndNodes != null) {
            for (LndNode lndNode : lndNodes) {
            if(lndNode.getStatus().equalsIgnoreCase("RUNNING")) {
                String walletContent = httpClientLnd.getLndNodeWalletBalance(tokenKey.getAccess_token(),lndNode.getLndNodeName());
                if (walletContent.contains("total_balance")) {
                    WalletBalance walletBalance = new WalletBalance();
                    walletBalance = walletBalance.mapContent(walletContent);
                    lndNode.setWalletBalance(walletBalance);
                    totalWalletBalance = totalWalletBalance + lndNode.getWalletBalance().getTotal_balance();
                }
                ArrayList<LndChannel> lndChannels = httpClientLnd.getLndChannelList(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                if (lndChannels != null) {
                    for (LndChannel lndChannel : lndChannels) {
                        totalReceived += Long.parseLong(lndChannel.getTotal_satoshis_received());
                        totalSent += Long.parseLong(lndChannel.getTotal_satoshis_sent());
                    }
                }
            }
            }
        }
        if (user.getCurrency().equals("bitcoin")) {
            totalWalletBalance *= Math.pow(10, -8);
            totalReceived *= Math.pow(10, -8);
            totalSent *= Math.pow(10, -8);
        } else if (user.getCurrency().equals("CAD") || user.getCurrency().equals("USD")) {
            BitcoinPrice bitcoinPrice = userService.getBTCPrice();
            if (bitcoinPrice != null) {
                if (user.getCurrency().equals("CAD")) {
                    totalWalletBalance *= Math.pow(10, -8) * bitcoinPrice.getCad();
                    totalReceived *= Math.pow(10, -8) * bitcoinPrice.getCad();
                    totalSent *= Math.pow(10, -8) * bitcoinPrice.getCad();
                } else {
                    totalWalletBalance *= Math.pow(10, -8) * bitcoinPrice.getUsd();
                    totalReceived *= Math.pow(10, -8) * bitcoinPrice.getUsd();
                    totalSent *= Math.pow(10, -8) * bitcoinPrice.getUsd();
                }
            }
        }
        modelAndView.addObject("totalBalance", totalWalletBalance);
        modelAndView.addObject("totalSent", totalSent);
        modelAndView.addObject("totalReceived", totalReceived);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("lnd_dashboard/fragments/wallet_balance");
        return modelAndView;
    }

    @RequestMapping(value = "/lnd-unlock", method = RequestMethod.POST)
    public Object unlockLndRequest(@RequestParam(value = "password") String password,
                                   @RequestParam(value = "nodeName") String nodeName,
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
        String content = null;

        content = httpClientLnd.unlockLndRequest(tokenKey.getAccess_token(), nodeName, passphrase);

        if (content != null && httpClientLnd.isJson(content)) {

            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.get("status").equals(200)) {
                JSONObject jsonObj = new JSONObject();
                jsonObj.put("status", "200").put("message", jsonObject.getString("object"));
                return new ResponseEntity<>(jsonObj.toString(), HttpStatus.OK);
            }
            if(!jsonObject.getString("object").isEmpty()){
                JSONObject jsonObj = new JSONObject();
                jsonObj.put("status", "400").put("message", jsonObject.getString("object"));
                return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", true).put("message", "Failed to Unlock Node");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
    }

    @RequestMapping(value = "/lnd-restart", method = RequestMethod.POST)
    public Object restartLndRequest(@RequestParam(value = "password") String password,
                                    @RequestParam(value = "nodeName")String nodeName,
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

        String content = null;

        content = httpClientLnd.restartLndRequest(tokenKey.getAccess_token(), nodeName, passphrase);

        if (content != null && httpClientLnd.isJson(content)) {

            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.get("status").equals(200)) {
                JSONObject jsonObj = new JSONObject();
                jsonObj.put("status", "200").put("message", jsonObject.getString("object"));
                return new ResponseEntity<>(jsonObj.toString(), HttpStatus.OK);
            }
            if(!jsonObject.getString("object").isEmpty()){
                JSONObject jsonObj = new JSONObject();
                jsonObj.put("status", "400").put("message", jsonObject.getString("object"));
                return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", true).put("message", "Failed to Restart Node");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
    }

    @RequestMapping(value = "/get-seed", method = RequestMethod.POST)
    public Object getSeed(@RequestParam(value = "nodeName") String nodeName,
                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        content = httpClientLnd.getNonCustodialSeed(tokenKey.getAccess_token(), nodeName);
        if (content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("status") && jsonObject.getInt("status") == 200){
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }else {
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "Failed to Get Seed");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
    }

    @RequestMapping(value = "/confirm-seed", method = RequestMethod.POST)
    public Object confirmSeed(@RequestParam(value = "nodeName") String nodeName,
                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        content = httpClientLnd.setNonCustodialRunning(tokenKey.getAccess_token(), nodeName);
        if (content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("status") && jsonObject.getInt("status") == 200){
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }else {
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "Failed to Get Seed");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
    }

    @RequestMapping(value = "/check-custodial", method = RequestMethod.GET)
    public Object isNonCustodial(@RequestParam(value = "lnd_name") String lnd_name, HttpSession session,
                              HttpServletRequest request, HttpServletResponse response) throws IOException {

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);

        if(lndNode != null){
            if (!lndNode.getIsNonCustodial()){
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Lnd Node is Custodial").put("non-custodial", false);
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }else {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Lnd Node is Non Custodial").put("non-custodial", true);
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "400").put("message", "Failed to Look Up Node").put("non-custodial", false);
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
    }

    @RequestMapping(value = "/get-transaction-fees", method = RequestMethod.GET)
    public Object getTransactionFees(@RequestParam(value = "address", required = false) String address,
                                     @RequestParam(value = "amount", required = false) Long amount,
                                     @RequestParam(value = "json") Boolean json,
                                     HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        String content_low = null;
        String content_med = null;
        String content_high = null;
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String value = null;

        String lnd_name = userService.getSessionLnd(session);
        if (lnd_name != null) {
            LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);
            String wallet_content = httpClientLnd.getWalletbalance(tokenKey.getAccess_token(), lnd_name);
            if (wallet_content != null || httpClientLnd.isJson(wallet_content)) {
                lndNode.setWalletBalance(new WalletBalance().mapContent(wallet_content));
                if (amount != null){
                    if (amount > lndNode.getWalletBalance().getConfirmed_balance()){
                        JSONObject jsonObject = new JSONObject();
                        jsonObject.put("status", 400).put("message", "Insufficient Funds for Transaction").put("error", true);
                        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
                    }else{
                        value = String.valueOf(amount);
                    }
                }else{
                    value = String.valueOf(lndNode.getWalletBalance().getConfirmed_balance()/2);
                }

            }else{
                if (amount == null) {
                    value = "1000";
                }else{
                    value = String.valueOf(amount);
                }
            }

            if(json) {
                if (address == null || address.equals("")) {
                    if (lndNode.getNetwork().equalsIgnoreCase("testnet")) {
                        address = "tb1q2xcxe8var06azf99entr60u839ntx0mr5et8hf";
                    } else if (lndNode.getNetwork().equalsIgnoreCase("regtest")) {
                        JSONObject jsonObject = new JSONObject();
                        jsonObject.put("status", "200").put("message", "No Fees for Simnet").put("transaction", "");
                        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
                    } else {
                        address = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
                    }
                }

                JSONObject jsonObject = new JSONObject();
                //low priority 3
                content_low = httpClientLnd.getTransactionEstimate(tokenKey.getAccess_token(), lnd_name, address, value, "9");
                logger.info(content_low);

                //medium priority 2
                content_med = httpClientLnd.getTransactionEstimate(tokenKey.getAccess_token(), lnd_name, address, value, "4");
                logger.info(content_med);

                //high priority 2
                content_high = httpClientLnd.getTransactionEstimate(tokenKey.getAccess_token(), lnd_name, address, value, "1");
                logger.info(content_high);
                jsonObject.put("status", "200").put("message", "Successfully Looked Up Transaction Fees")
                        .put("transaction_low", content_low).put("transaction_med", content_med).put("transaction_high", content_high);

                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }else{
                if (address == null){
                    JSONObject jsonObject = new JSONObject();
                    jsonObject.put("status", "400").put("message", "Address Cannot Be Null");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
                }

                if (amount == null){
                    JSONObject jsonObject = new JSONObject();
                    jsonObject.put("status", "400").put("message", "Amount Cannot Be Null");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
                }

                ModelAndView modelAndView = new ModelAndView();
                modelAndView.addObject("destination", address);
                modelAndView.addObject("amount", amount);

                String content = httpClientLnd.getTransactionEstimate(tokenKey.getAccess_token(), lnd_name, address, String.valueOf(amount), "1");
                JSONObject jsonObject = new JSONObject(content);

                if (jsonObject.has("fee_sat") && jsonObject.has("sat_per_vbyte")) {
                    modelAndView.addObject("total_fees", jsonObject.get("fee_sat"));
                    modelAndView.addObject("sat_per_vbyte", jsonObject.get("sat_per_vbyte"));
                }else{
                    modelAndView.addObject("total_fees", "Could Not Calculate");
                    modelAndView.addObject("sat_per_vbyte", "Could Not Calculate");
                }

                modelAndView.addObject("total_amount", amount);
                modelAndView.addObject("lnd_name", lnd_name);
                modelAndView.setViewName("payment/fragments/btc-fee-modal");
                return modelAndView;
            }
        }

        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "400").put("message", "Failed to Look Up Transaction Fee");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

    }
}

