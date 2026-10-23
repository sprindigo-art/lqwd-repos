package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.Subscription;
import lqwd.frontend.model.User;
import lqwd.frontend.service.UserService;
import org.apache.http.HttpException;
import org.json.simple.parser.ParseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.ArrayList;

@Controller
public class SubscriptionController {

    private static Logger logger = LoggerFactory.getLogger(SubscriptionController.class);

    @Autowired
    private UserService userService;

    @Autowired
    private TokenKey tokenKey;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;

    @RequestMapping(value="/subscription", method = RequestMethod.GET)
    public ModelAndView subscription(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, ParseException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        Subscription subscription = new Subscription();
        ArrayList<Subscription> subscriptions = subscription.mapSubscriptionTypes();

        user.setCurrency(userService.getSessionCurrency(session));
        user.setAccountInfo(httpClientToken.getUserAccountInfo(tokenKey.getAccess_token()));

        modelAndView.addObject("subscriptions", subscriptions);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("subscription/subscription");
        return modelAndView;
    }

}
