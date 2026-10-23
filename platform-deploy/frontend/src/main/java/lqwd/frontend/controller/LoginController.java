package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.LndNode;
import lqwd.frontend.model.User;
import lqwd.frontend.service.UserService;
import org.jboss.aerogear.security.otp.Totp;
import org.jboss.aerogear.security.otp.api.Base32;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Optional;

import org.json.*;

@Controller
public class LoginController {

    private static Logger logger = LoggerFactory.getLogger(LoginController.class);

    @Autowired
    private UserService userService;

    @Autowired
    private TokenKey tokenKey;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;


    @RequestMapping(value={"/","/login"}, method = RequestMethod.GET)
    public ModelAndView login(HttpSession session, HttpServletRequest request) throws IOException {

        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        if (tokenKey != null) {
            if (tokenKey.getAccess_token() != null) {

                User user = httpClientToken.getUser(tokenKey.getAccess_token());
                if (user.getEmail() != null) {
                    user.setCurrency(userService.getSessionCurrency(session));
                    return new ModelAndView("redirect:/profile");
                }
            }
        }

        modelAndView.setViewName("auth/login-light");
        return modelAndView;
    }

    @RequestMapping(value = {"/token/check"}, method = RequestMethod.GET)
    public ResponseEntity refreshtoken(HttpServletResponse response, HttpSession session) {
        TokenKey tokenKey = userService.getSessionToken(session);
        JSONObject jsonObject = new JSONObject();
        boolean logout = false;
        if(tokenKey != null && tokenKey.getRefresh_token() != null && tokenKey.getRequestedSystemTime() != null){
            try {
            	
            	Long currentTime = System.currentTimeMillis()/1000;
            	
            	Long timeToElapse = (tokenKey.getRequestedSystemTime()/1000) + tokenKey.getExpires_in();
            	
                //check if we can refresh token.
                Long diffInTimeInSecs = timeToElapse - currentTime;

                //if time left for token to expire is less than 2 mins then refresh
                if(diffInTimeInSecs < 120){
                    tokenKey = httpClientToken.getRefreshedToken(tokenKey.getRefresh_token());
                    userService.saveSessionInfo(response, session, tokenKey, null, null);
                    if(tokenKey.getAccess_token() == null){
                        logout = true;
                    }
                }
            } catch (IOException e) {
                logout = true;
                e.printStackTrace();
            }
        }
        jsonObject.append("logout", logout);
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }


    @RequestMapping(value = {"/logout", "/signout"}, method = RequestMethod.GET)
    public ModelAndView logout(HttpServletResponse response, HttpSession session) throws IOException {
        userService.removeSessionInfo(response, session);
        return new ModelAndView("redirect:/");
    }

    @RequestMapping(value = {"/access-denied"}, method = RequestMethod.GET)
    public ModelAndView autherror() {
        return new ModelAndView("redirect:/login");
    }

    @RequestMapping(value = {"/login-check"}, method = RequestMethod.POST)
    public Object loginCheckCredentials(HttpSession session, HttpServletRequest request,
                                                @RequestParam(value = "email") String email,
                                                @RequestParam(value = "password") String password) throws UnsupportedEncodingException {

        String content = httpClientToken.checkCredentials(email, password);

        if (content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("status") && jsonObject.get("status").equals(200)){
                JSONObject jsonObject1 = new JSONObject();
                jsonObject1.put("error",false).put("message","Email and Password Verified");
                return new ResponseEntity<>(jsonObject1.toString(), HttpStatus.OK);
            }else{
                JSONObject jsonObject1 = new JSONObject();
                jsonObject1.put("error",true).put("message","Email and/or Password Incorrect");
                return new ResponseEntity<>(jsonObject1.toString(), HttpStatus.FORBIDDEN);
            }
        }else{
            JSONObject jsonObject1 = new JSONObject();
            jsonObject1.put("error",true).put("message","Failed to Check Email and Password");
            return new ResponseEntity<>(jsonObject1.toString(), HttpStatus.BAD_REQUEST);
        }
    }

    @RequestMapping(value = "/homepage", method = RequestMethod.POST)
    public Object home(User user, @RequestParam(value = "code") String code, HttpServletResponse response, HttpSession session) throws IOException {

        //get token for user from give login parameters
        String content = httpClientToken.getTokenMfa(user, code);

        if (content != null){
            JSONObject loginResponse = new JSONObject(content);
            if (loginResponse.has("status") && loginResponse.get("status").equals(200)){
                tokenKey = new TokenKey().mapContent(content);
                //get user information to check if using 2fa
                if (tokenKey.getAccess_token() == null) {
                    JSONObject jsonObject = new JSONObject();
                    jsonObject.put("error",true)
                            .put("message","Failed to Login, Unable to Authenticate User");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
                }else{
                    user = httpClientToken.getUser(tokenKey.getAccess_token());
                    logger.info(user.toString());
                    userService.saveSessionInfo(response, session, tokenKey, null, null);

                    JSONObject jsonObject = new JSONObject();
                    jsonObject.put("status", "200")
                            .put("message", "Successfully Logged In!");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
                }
            }else{
                return new ResponseEntity<>(loginResponse.toString(), HttpStatus.BAD_REQUEST);
            }
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true)
                    .put("message","Failed to Login, Unable to Authenticate User");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
    }

    @RequestMapping(value = "/dashboard", method = RequestMethod.GET)
    public ModelAndView dashboard(HttpServletRequest request, HttpSession session, HttpServletResponse response) {

        ModelAndView modelAndView = new ModelAndView();
        try {
            tokenKey = userService.getSessionInfo(request, session);

            User user = httpClientToken.checkUser(tokenKey);
            if (user == null) {

                userService.removeSessionInfo(response, session);
                return new ModelAndView("redirect:/");
            }

            user.setCurrency(userService.getSessionCurrency(session));

            modelAndView.addObject("tokenKey", tokenKey);
            ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
            if (lndNodes != null) {
                modelAndView.addObject("lndNodes", lndNodes);

            }
            modelAndView.addObject("user", user);
            modelAndView.addObject("userName", "Welcome " + user.getEmail());

            modelAndView.addObject("adminMessage", "Content Available Only for Users with Admin Role");

            modelAndView.setViewName("dashboard/desktop");

            return modelAndView;
        } catch (JSONException | IOException err) {
            err.printStackTrace();
            logger.error(err.toString());
            return new ModelAndView("redirect:/");
        }
    }

    //route to see password recovery view
    @RequestMapping(value = "/forgot-password", method = RequestMethod.GET)
    public ModelAndView passRecoveryView() {
        ModelAndView modelAndView = new ModelAndView();
        modelAndView.setViewName("auth/auth_recovery_password");
        return modelAndView;
    }

    //route for password recovery post request using email which will be handled by HttpClientToken API request
    @RequestMapping(value = "/recovery", method = RequestMethod.POST)
    public ModelAndView passRecovery(@RequestParam String email) throws IOException {

        ModelAndView modelAndView = new ModelAndView();
        //when api exists content will be used
        String content = httpClientToken.passwordRecovery(email);
        if(content != null) {
            logger.info(content);
        }
        //depends on response in future
        if (content.equals("success") || content.equals("200")) {
            modelAndView.setStatus(HttpStatus.OK);
            modelAndView.addObject("forgot_password", true);
            modelAndView.setViewName("redirect:/login");
            return modelAndView;
        }
        modelAndView.setStatus(HttpStatus.BAD_REQUEST);
        modelAndView.setViewName("redirect:/login");
        return modelAndView;
    }

    //verify email get request
    @RequestMapping(value = "/confirm-account", method = RequestMethod.GET)
    public ModelAndView verifyEmailView(@RequestParam("token") String token) throws URISyntaxException, IOException {
        ModelAndView modelAndView = new ModelAndView();

        User user = httpClientToken.confirmAccount(token);

        if (user.getUsername() == null) {
            modelAndView.addObject("verified", false);
            modelAndView.setViewName("redirect:/login");
            return modelAndView;
        }

        modelAndView.addObject("verified", true);
        modelAndView.setViewName("redirect:/login");
        return modelAndView;
    }


    @RequestMapping(value = "/email-verification", method = RequestMethod.GET)
    public Object verifyEmail(HttpServletRequest request, HttpServletResponse response, HttpSession session) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
          userService.removeSessionInfo(response, session);
          if(userService.isAjax(request)){
              JSONObject jsonObject = new JSONObject();
              jsonObject.put("error",true).put("message","Token Expired");
              return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
          }else{
              return new ModelAndView("redirect:/login");
          }
        }
      
        String content = httpClientToken.sendVerificationEmail(user.getEmail());
        if(userService.isAjax(request)){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "200").put("message", "Verification Email Sent!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
        }else{
            return new ModelAndView("redirect:/dashboard");
        }
    }

    @RequestMapping(value = "/reset-password", method = RequestMethod.GET)
    public ModelAndView resetPasswordView(@RequestParam("token") String token, HttpSession session, HttpServletRequest request, HttpServletResponse response) {
        ModelAndView modelAndView = new ModelAndView();
        modelAndView.addObject("token", token);
        modelAndView.setViewName("auth/reset_password");

        return modelAndView;
    }

    @RequestMapping(value = "/change-password", method = RequestMethod.POST)
    public ModelAndView resetPassword(HttpServletRequest request, HttpServletResponse response, HttpSession session,
                                      @RequestParam("token") String token,
                                      @RequestParam("email") String email,
                                      @RequestParam("password") String password,
                                      @RequestParam("confirm-password") String confirmPassword) throws IOException {

        String content = null;
        ModelAndView modelAndView = new ModelAndView();
        if(password.equals(confirmPassword)){
            content = httpClientToken.changePassword(token, email, password);
        }

        User user = new User();
        user.setEmail(email);
        user.setPassword(password);

        if(content != null) {
            if (content.equals("200") || content.equals("success")) {
                tokenKey = httpClientToken.getToken(user, new TokenKey());
                user = httpClientToken.getUser(tokenKey.getAccess_token());
                user.setFa2(false);

                httpClientToken.updateAccount(user, tokenKey.getAccess_token());
                modelAndView.addObject("password_updated", true);
            } else {
                modelAndView.addObject("password_updated", false);
            }
        } else {
            modelAndView.addObject("password_updated", false);
        }

        modelAndView.setViewName("redirect:/login");

        return modelAndView;
    }

    @RequestMapping(value = "/check-username", method = RequestMethod.POST)
    public Object requestCheckUsername(@RequestParam("username") String username) throws UnsupportedEncodingException {

        String content = httpClientToken.checkUsername(username);
        JSONObject jsonObject = new JSONObject(content);

        if(((String) jsonObject.get("object")).equals("ok")){
            JSONObject jsonObj = new JSONObject();
            jsonObj.put("error", false).put("message", "Username OK");
            return new ResponseEntity<>(jsonObj.toString(), HttpStatus.OK);
        }else{
            JSONObject jsonObj = new JSONObject();
            jsonObj.put("error",true).put("message","Username Used");
            return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
        }
    }

    @RequestMapping(value = "/check-email", method = RequestMethod.POST)
    public Object requestCheckEmail(@RequestParam("email") String email) throws UnsupportedEncodingException {

        String content = httpClientToken.checkEmail(email);

        JSONObject jsonObject = new JSONObject(content);

        if(((String) jsonObject.get("object")).equals("ok")){
            JSONObject jsonObj = new JSONObject();
            jsonObj.put("error", false).put("message", "Email OK");
            return new ResponseEntity<>(jsonObj.toString(), HttpStatus.OK);
        }else{
            JSONObject jsonObj = new JSONObject();
            jsonObj.put("error",true).put("message","Email Not Valid");
            return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
        }
    }

    //Methods to Catch 405 Exceptions
    @RequestMapping(value = "/homepage", method = RequestMethod.GET)
    public ModelAndView redirectHomepageGet(){
        return new ModelAndView("redirect:/profile");
    }

    @RequestMapping(value = "/recovery", method = RequestMethod.GET)
    public ModelAndView redirectPassRecovery() throws IOException {
        return new ModelAndView("redirect:/login");
    }

    @RequestMapping(value = "/error", method = RequestMethod.GET)
    public ModelAndView errorView() {
        return new ModelAndView("error/404");
    }


    @RequestMapping(value = "/toggle-color", method = RequestMethod.GET)
    public Object toggleColorMode(@RequestParam("light") Boolean light, HttpSession session,
                                          HttpServletRequest request, HttpServletResponse response){
        ModelAndView modelAndView = new ModelAndView();

        JSONObject jsonObject = new JSONObject();

        tokenKey = userService.getSessionInfo(request, session);
        if (tokenKey.getAccess_token() == null){
            userService.removeSessionInfo(response, session);
            jsonObject.put("error", true).put("message", "Session Expired Please Login").put("status", HttpStatus.BAD_REQUEST);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        userService.saveSessionInfo(response, session, tokenKey, null, light);
        jsonObject.put("error", false).put("message", "Successfully Updated Color Mode").put("status", HttpStatus.OK);
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }

    @RequestMapping(value = "/set-lnd-session", method = RequestMethod.GET)
    public Object setLndSession(@RequestParam("lnd_name") String lnd_name, HttpSession session,
                                  HttpServletRequest request, HttpServletResponse response){
        ModelAndView modelAndView = new ModelAndView();

        JSONObject jsonObject = new JSONObject();

        logger.info(lnd_name);
        tokenKey = userService.getSessionInfo(request, session);
        if (tokenKey.getAccess_token() == null){
            userService.removeSessionInfo(response, session);
            jsonObject.put("error", true).put("message", "Session Expired Please Login").put("status", HttpStatus.BAD_REQUEST);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        userService.saveSessionInfo(response, session, tokenKey, null, null, lnd_name);
        jsonObject.put("error", false).put("message", "Successfully Updated Color Mode").put("status", HttpStatus.OK);
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }

    @RequestMapping(value = "/get-lnd-nodes", method = RequestMethod.GET)
    public Object getLndNodesForUser(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();

        JSONObject jsonObject = new JSONObject();

        tokenKey = userService.getSessionInfo(request, session);
        if (tokenKey == null) {
            userService.removeSessionInfo(response, session);
            jsonObject.put("error", true).put("message", "Session Expired Please Login").put("status", HttpStatus.BAD_REQUEST);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {

            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/");
        }

        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        if (lndNodes == null){
            jsonObject.put("error", true).put("message", "Couldn't Load LND Nodes for User").put("status", HttpStatus.BAD_REQUEST);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        user.setLndNodes(lndNodes);
        String lnd_name = userService.getSessionLnd(session);
        if(lnd_name != null) {
            LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);
        	if(lndNode != null) {
                if (lndNode.getIsNonCustodial() != null) {
                    modelAndView.addObject("is_non_custodial", lndNode.getIsNonCustodial() ? "1" : "0");
                }
        	}
        }
        modelAndView.addObject("user", user);
        modelAndView.setViewName("layout/fragment/session-select");
        return modelAndView;

    }
}
