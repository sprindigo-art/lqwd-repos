package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.LightningStats;
import lqwd.frontend.model.LndNode;
import lqwd.frontend.model.LndNodeInfo;
import lqwd.frontend.model.User;
import lqwd.frontend.repository.LightningStatsRepository;
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
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.ModelAndView;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Controller
public class DesktopController {

    private static Logger logger = LoggerFactory.getLogger(DesktopController.class);

    @Autowired
    private UserService userService;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;

    @Autowired
    private TokenKey tokenKey;

    @Autowired
    LightningStatsRepository lightningStatsRepository;

    private ModelAndView afterHttpclientCall(ModelAndView modelAndView, String content){
        if(content == null){
            modelAndView.addObject("message", "No Information Available");
            return new ModelAndView("dashboard/content_unavailable");
        }

        try {
            logger.info(content);
            JSONObject jsonObject = new JSONObject(content);
            if(jsonObject.has("status")){
                if((Integer)jsonObject.get("status") == 403){
                    modelAndView.addObject("message", "Session Expired, Please Login Again.");
                    return new ModelAndView("dashboard/content_unavailable");
                }else if ((Integer)jsonObject.get("status") == 204){
                    modelAndView.addObject("message", "No Content Yet.");
                    return new ModelAndView("dashboard/content_unavailable");
                }
            }
        }catch (JSONException err){
            logger.error("Error", err.toString());
        }

        modelAndView.addObject("channels", content);
        modelAndView.setViewName("dashboard/desktopAjax");
        return modelAndView;
    }

    @RequestMapping(value="/desktop", method = RequestMethod.GET)
    public String desktop(HttpServletRequest request, HttpSession session, Model model) throws IOException {
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);


        model.addAttribute("user", user);
        model.addAttribute("action", "none");
        return "dashboard/desktop";
    }
    @RequestMapping(value="/transactionhistory", method = RequestMethod.POST)
    public Object transactionhistory(@RequestParam("lnd_name") String lnd_name, HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        String content = httpClientLnd.getAllTransactionsByNodeContent(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
    }
    @RequestMapping(value="/getinfo", method = RequestMethod.POST)
    public Object getinfo(HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
            //            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        String lnd_name = userService.getSessionLnd(session);
//        String content = httpClientLnd.getInfo(tokenKey.getAccess_token(), lnd_name);
//        return afterHttpclientCall(modelAndView, content);

        String content = httpClientLnd.getInfo(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
    }

    @RequestMapping(value="/channels", method = RequestMethod.POST)
    public Object channels(HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);

        String content = httpClientLnd.getChannels(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
//        return afterHttpclientCall(modelAndView, content);

    }

    @RequestMapping(value="/peers", method = RequestMethod.POST)
    public Object peers(HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);
        String content = httpClientLnd.getPeers(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
//        return afterHttpclientCall(modelAndView, content);

    }

    @RequestMapping(value="/fees", method = RequestMethod.POST)
    public Object fees(HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);
        String content = httpClientLnd.getFees(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
//        return afterHttpclientCall(modelAndView, content);

    }

    @RequestMapping(value="/walletbalance", method = RequestMethod.POST)
    public Object walletbalance(HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);
        String content = httpClientLnd.getWalletbalance(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
//        return afterHttpclientCall(modelAndView, content);

    }

    @RequestMapping(value="/getrecoveryinfo", method = RequestMethod.POST)
    public Object getRecoveryinfo(HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);
        String content = httpClientLnd.getRecoveryinfo(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
//        return afterHttpclientCall(modelAndView, content);

    }

    @RequestMapping(value="/channelbalance", method = RequestMethod.POST)
    public Object channelbalance(HttpServletRequest request, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey.getAccess_token() == null ){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user == null){
            modelAndView.addObject("message", "No Information Available");
//            return new ModelAndView("dashboard/content_unavailable");
            return new ResponseEntity<>(new JSONObject("No Information Available").toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);
        String content = httpClientLnd.getChannelbalance(tokenKey.getAccess_token(), lnd_name);
        return new ResponseEntity<>(content, HttpStatus.OK);
//        logger.info(content);
//        return afterHttpclientCall(modelAndView, content);

    }


    @RequestMapping(value = "/sseconsumer", method = RequestMethod.GET)
    public SseEmitter handleRequest (HttpServletRequest request, HttpSession session) throws IOException {

        String lnd_name = userService.getSessionLnd(session);
        tokenKey = userService.getSessionInfo(request, session);

        final SseEmitter emitter = new SseEmitter();
        ExecutorService service = Executors.newSingleThreadExecutor();

        service.execute(() -> {

            try {
                String str = "";
                User user = httpClientToken.getUser(tokenKey.getAccess_token());
                str = httpClientLnd.consumerInfo(tokenKey.getAccess_token(), lnd_name);

                logger.info("Content string from sseconsumer: " + str);
                if(str.length() > 0) {
                    JSONObject tmessage = new JSONObject(str);
//                    logger.info(str);

                    emitter.send(tmessage.toString(), MediaType.TEXT_PLAIN);
                }


                Thread.sleep(200);
            } catch (Exception e) {
//                e.printStackTrace();
                logger.error(e.getMessage());
                emitter.completeWithError(e);
                return;
            }

            emitter.complete();
        });

        return emitter;
    }


    @RequestMapping(value = "/lnstats", method = RequestMethod.GET)
    public ModelAndView showAnalytics(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        ArrayList<LightningStats> lightningStats = lightningStatsRepository.getLightningStatsByLastupdated();
        LightningStats latestLightningStats = lightningStatsRepository.getLatestLightningStatsByLastupdated();

        modelAndView.addObject("user", user);
        modelAndView.addObject("lightningStats", latestLightningStats);
        modelAndView.addObject("lightningStatsArray", lightningStats);
        modelAndView.setViewName("analytics/analytics_dashboard");
        return modelAndView;
    }
}
