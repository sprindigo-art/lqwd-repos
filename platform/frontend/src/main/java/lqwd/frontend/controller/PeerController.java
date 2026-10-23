package lqwd.frontend.controller;

import lqwd.frontend.captcha.ICaptchaService;
import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.LndNode;
import lqwd.frontend.model.Peer;
import lqwd.frontend.model.User;
import lqwd.frontend.model.WalletBalance;
import lqwd.frontend.repository.BetaSignupRepository;
import lqwd.frontend.service.MailService;
import lqwd.frontend.service.UserService;
import org.bouncycastle.math.raw.Mod;
import org.jboss.aerogear.security.otp.Totp;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.parameters.P;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Optional;

@Controller
public class PeerController {

    private static Logger logger = LoggerFactory.getLogger(lqwd.frontend.controller.PeerController.class);

    @Autowired
    private UserService userService;

    @Autowired
    private TokenKey tokenKey;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;

    @Autowired
    HttpClientApiKey httpClientApiKey;

    //main peers page
    @RequestMapping(value = "/peer-connect", method = RequestMethod.GET)
    public ModelAndView peersPageView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("peer/peer-page");
        return modelAndView;
    }

    //connect to peer
    @RequestMapping(value = "/connect-peer", method = RequestMethod.POST)
    public Object connectPeer(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                              @RequestParam(value = "node_key") String node_key,
                              @RequestParam(value = "hostname") String hostname,
                              @RequestParam(value = "port") String port,
                              @RequestParam(value = "password", required = false) String password,
                              @RequestParam(value = "passphrase", required = false) String passphrase) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        //check if connected to peer
        String lnd_name = userService.getSessionLnd(session);
        String content_peer = httpClientLnd.connectToPeer(tokenKey.getAccess_token(), lnd_name, node_key, hostname, port, passphrase);
        logger.info(content_peer);

        if (content_peer != null && httpClientLnd.isJson(content_peer)) {
            JSONObject jsonObject = new JSONObject(content_peer);

            if (jsonObject.isEmpty()){
                jsonObject.put("status", 200).put("message", "Successfully Connected to Peer");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }

            if (jsonObject.has("status")) {
                if (jsonObject.get("status").equals(200)) {
                    jsonObject.put("status", 200).put("message", "Successfully Connected to Peer");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
                } else if(jsonObject.has("error") && jsonObject.get("error")!=null){
                    if(jsonObject.get("error").toString().contains("already conneected to peer")){
                        JSONObject jsonObj = new JSONObject();
                        jsonObj.put("status", 400).put("message", "Already Connected to Peer");
                        return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
                    } else {
                        JSONObject jsonObj = new JSONObject();
                        jsonObj.put("status", 400).put("message", jsonObject.get("error").toString());
                        return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
                    }
                }else{
                    JSONObject jsonObj = new JSONObject();
                    jsonObj.put("status", 400).put("message", jsonObject.get("message").toString());
                    return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
                }
            }
        }


        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", 400).put("message", "Failed to Connect to Peer");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

    }

    //load list of peers
    @RequestMapping(value = "/get-peers", method = RequestMethod.GET)
    public Object getPeers(@RequestParam(value = "page") Optional<Integer> pageNum,
                           @RequestParam(required = false, defaultValue = "10", value = "size") int size,
                           @RequestParam Optional<String> query,
                           @RequestParam (required = false, defaultValue = "1", value = "startPageIndex") int startPageIndex,
                           @RequestParam (required = false, defaultValue = "5", value = "endPageIndex") int endPageIndex,
                           @RequestParam (required = false, defaultValue = "false", value = "updatePageSet") boolean updatePageSet,
                           HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        String lnd_name = userService.getSessionLnd(session);
        //get peers
        ArrayList<Peer> peers = new ArrayList<>();
        Peer peer = new Peer();

        String content = httpClientLnd.getPeers(tokenKey.getAccess_token(), lnd_name);
        logger.info(content);
        if (content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("peers")) {
                ArrayList<Peer> peers_tmp = peer.mapPeerListContent(content, lnd_name);
                if (peers_tmp != null) {
                    peers.addAll(peers_tmp);
                }
            }else if (jsonObject.has("error") && jsonObject.getString("error") != null){
                logger.info((String) jsonObject.get("error"));
                JSONObject jsonObject1 = new JSONObject();
                jsonObject1.put("status", "400").put("message", jsonObject.getString("error"));
                return new ResponseEntity<>(jsonObject1.toString(), HttpStatus.BAD_REQUEST);
            }else{
                JSONObject jsonObject1 = new JSONObject();
                jsonObject1.put("status", "400").put("message", "Failed to Load Peers");
                return new ResponseEntity<>(jsonObject1.toString(), HttpStatus.BAD_REQUEST);
            }
        }
//        JSONObject jsonObj = new JSONObject(content);
//        int total = jsonObj.getJSONObject("data").getInt("total");
//        int totalPages = (int) Math.ceil((double)total / size);
        int total = peers.size();
        int totalPages = 1;
        if(updatePageSet){
            if (endPageIndex >= totalPages){
                endPageIndex = totalPages;
            }

        }
        if(totalPages <= 5) {
            startPageIndex = 1;
            endPageIndex = totalPages;
        }



//        if (peers.isEmpty()){
//            JSONObject jsonObject = new JSONObject();
//            jsonObject.put("status", "400").put("message", "Failed to Load Peers");
//            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
//        }
        logger.info(peers.toString());
        ModelAndView modelAndView = new ModelAndView();
        modelAndView.addObject("user",user);
        modelAndView.addObject("peersList", peers);
        modelAndView.addObject("startPageIndex",startPageIndex);
        modelAndView.addObject("endPageIndex",endPageIndex);
        modelAndView.addObject("curentPage", pageNum.get());
        modelAndView.addObject("totalItems", total);
        modelAndView.addObject("totalPages", totalPages);
        modelAndView.setViewName("peer/fragments/peer-list-table");
        return modelAndView;
    }

    @RequestMapping(value = "/peers-list", method = RequestMethod.GET)
    public Object getPeerDetailsFragment(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        modelAndView.addObject("user",user);
        modelAndView.setViewName("peer/peer-list");
        return modelAndView;
    }
}
