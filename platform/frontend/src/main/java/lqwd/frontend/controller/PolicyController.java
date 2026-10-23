package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.CookiePolicy;
import lqwd.frontend.model.PrivacyPolicy;
import lqwd.frontend.model.TermsPolicy;
import lqwd.frontend.service.UserService;
import org.json.simple.parser.ParseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.ModelAndView;

import java.io.IOException;
import java.util.ArrayList;


@Controller
public class PolicyController {
    private static Logger logger = LoggerFactory.getLogger(PolicyController.class);


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

    @RequestMapping(value = "/cookies",method = RequestMethod.GET)
    public ModelAndView getCokkies(){
        ModelAndView modelAndView = new ModelAndView();
        CookiePolicy cookiePolicy = new CookiePolicy();
        ArrayList<CookiePolicy> cookiePolicies = null;
        try {
            cookiePolicies = cookiePolicy.mapCookiePolicies();
        } catch (IOException e) {
            e.printStackTrace();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        modelAndView.addObject("cookiePolicies",cookiePolicies);
        modelAndView.setViewName("policy/cookies");
        return modelAndView;
    }

    @RequestMapping(value = "/terms",method = RequestMethod.GET)
    public ModelAndView getTerms(){
        ModelAndView modelAndView = new ModelAndView();
        TermsPolicy termsPolicy = new TermsPolicy();
        ArrayList<TermsPolicy> termsPolicies = null;
        try {
            termsPolicies = termsPolicy.mapTermsPolicy();
        } catch (IOException e) {
            e.printStackTrace();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        modelAndView.addObject("termsPolicies",termsPolicies);
        modelAndView.setViewName("policy/terms");
        return modelAndView;
    }

    @RequestMapping(value = "/privacy",method = RequestMethod.GET)
    public ModelAndView getPrivacy(){
        ModelAndView modelAndView = new ModelAndView();
        PrivacyPolicy privacyPolicy = new PrivacyPolicy();
        ArrayList<PrivacyPolicy> privacyPolicies = null;
        try {
            privacyPolicies = privacyPolicy.mapPrivacyPolicies();
        } catch (IOException e) {
            e.printStackTrace();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        modelAndView.addObject("privacyPolicies",privacyPolicies);
        modelAndView.setViewName("policy/privacy");
        return modelAndView;
    }
}

