package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.ApiKey;
import lqwd.frontend.model.Requests;
import lqwd.frontend.model.User;
import lqwd.frontend.service.UserService;
import org.json.JSONException;
import org.json.JSONObject;
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
import java.util.List;

@Controller
public class AccountingController {

    private static Logger logger = LoggerFactory.getLogger(AccountingController.class);

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

    @RequestMapping(value = "/account-info", method = RequestMethod.GET)
    public ModelAndView getAccountInfo(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        user.setAccountInfo(httpClientToken.getUserAccountInfo(tokenKey.getAccess_token()));
        modelAndView.addObject("user", user);
        modelAndView.setViewName("profile/account_info");
        return modelAndView;


    }
    @RequestMapping(value = "/request-accounting", method = RequestMethod.GET)
    public ModelAndView requestAccounting(@RequestParam(value = "apikey", required = false) String apikey, HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        String content = httpClientApiKey.getListOfKeys(tokenKey.getAccess_token());
        if(content != null){
            user.mapApiKeyContent(content);
        }

        if(apikey != null) {
            ApiKey apiKey = new ApiKey(apikey);
            apiKey.setTotalElements(httpClientApiKey.getApiTotalElements(tokenKey.getAccess_token(), apiKey.getApikey()));
            apiKey.setRequests(httpClientApiKey.getApiRequestHistory(tokenKey.getAccess_token(), apiKey.getApikey(), apiKey.getTotalElements(), "0"));
            modelAndView.addObject("apiKey", apiKey);

        }else{
            ApiKey apiKey = new ApiKey();
            modelAndView.addObject("apiKey", apiKey);
        }

        modelAndView.addObject("user", user);

        modelAndView.setViewName("requests/request_history");
        return modelAndView;
    }

    @RequestMapping(value = "/change-currency", method = RequestMethod.POST)
    public Object setSessionCurrencyInfo(@RequestParam("currency") String currency, HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        userService.setSessionCurrency(session, currency);
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", false).put("message", "Successfully Updated Currency");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);

    }
}
