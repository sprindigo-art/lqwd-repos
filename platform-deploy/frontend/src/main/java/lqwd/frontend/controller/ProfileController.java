package lqwd.frontend.controller;

//import com.sun.org.apache.xpath.internal.operations.Mod;
import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.ApiKey;
import lqwd.frontend.model.User;
import lqwd.frontend.service.UserService;
import org.apache.http.HttpException;
import org.jboss.aerogear.security.otp.api.Base32;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.parameters.P;
import org.springframework.stereotype.Controller;
        import org.springframework.ui.ModelMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.ModelAndView;
//import sun.tools.jstat.Token;

import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Controller
public class ProfileController {

    private static Logger logger = LoggerFactory.getLogger(ProfileController.class);

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

    private ModelAndView afterHttpclientCall(ModelAndView modelAndView, String content) throws HttpException {
        if(content == null){
            throw new HttpException("Failed");
        }

        try {
            JSONObject jsonObject = new JSONObject(content);
            if(jsonObject.has("status")){
                if((Integer)jsonObject.get("status") == 403){
                    ModelMap modelMap = new ModelMap();
                    modelMap.addAttribute("error", "Session expired");
                    throw new HttpException("Failed");
                }
            }
        }catch (JSONException err){
            logger.error("Error", err.toString());
            throw new HttpException("Failed");
        }

        modelAndView.addObject("content", content);
        modelAndView.setViewName("profile/userprofileAjax");
        return modelAndView;
    }

    /*
        Route to direct user to their User Profile
     */
    @RequestMapping(value="/profile", method = RequestMethod.GET)
    public ModelAndView profileView(HttpServletRequest request, HttpServletResponse response, HttpSession session) throws IOException{

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        //get api key list
        String content = httpClientApiKey.getListOfKeys(tokenKey.getAccess_token());

        if(content != null && httpClientLnd.isJson(content)){
            user.mapApiKeyContent(content);
        }

        ArrayList<ApiKey> apiKeys = user.getApiKeyList();
        for (ApiKey apiKey: apiKeys) {
            apiKey.setTotalElements(httpClientApiKey.getApiTotalElements(tokenKey.getAccess_token(), apiKey.getApikey()));
        }

        user.setApiKeyList(apiKeys);

        modelAndView.addObject("user", user);
        modelAndView.addObject("token", tokenKey.getAccess_token());
        modelAndView.setViewName("profile/user_profile");
        return modelAndView;

    }

    //get account settings view with populated data using session token
    @RequestMapping(value = "/account-settings", method = RequestMethod.GET)
    public ModelAndView accountSettings(HttpServletRequest request, HttpServletResponse response, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        modelAndView.addObject("user", user);
        modelAndView.addObject("tokenKey", tokenKey.getAccess_token());

        modelAndView.setViewName("settings/account_settings");

        return modelAndView;
    }

    //api generate key route
    @RequestMapping(value="/generate-api-key", method = RequestMethod.POST)
    public @ResponseBody String generateApiKey(@RequestParam("password") String password,
                                               HttpServletRequest request,
                                               HttpServletResponse response,
                                               HttpSession session)
            throws IOException, HttpException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            throw new HttpException("Failed to Generate API Key");
        }
        user.setToken(tokenKey.getAccess_token());
        user.setPassword(password);
        String content = httpClientApiKey.generateApiKey(user);

        if(content == null){
            throw new HttpException("Failed to Generate API Key");

        }

        try {
            JSONObject jsonObject = new JSONObject(content);
            if(jsonObject.has("status")){
                if((Integer)jsonObject.get("status") == 403){
                    throw new HttpException("Failed to Generate API Key");
                }
            }
        }catch (JSONException | HttpException err){
            logger.error("Error", err.toString());
        }

        ApiKey apiKey = new ApiKey();
        apiKey = apiKey.mapContent(content);

        return apiKey.getApikey();
    }


    //api reset password route
    @RequestMapping(value="/resetpassword", method = RequestMethod.POST)
    public Object resetPasswordAccountSettings(@RequestParam("curr_pass") String curr_pass,
                                        @RequestParam("new_pass") String new_pass,
                                        @RequestParam("new_pass_confirm") String new_pass_confirm,
                                        HttpServletRequest request,
                                        HttpSession session,
                                        HttpServletResponse response) throws IOException, HttpException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);

        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status","400")
                    .put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        //update password call
        String content = httpClientToken.resetPassword(tokenKey.getAccess_token(), user, curr_pass, new_pass);
        if(content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject_tmp = new JSONObject(content);
            if(jsonObject_tmp.get("status").equals(200)){
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status","200")
                        .put("message","Successfully Updated Password");

                tokenKey = tokenKey.mapContent(content);
                userService.saveSessionInfo(response, session, tokenKey, user.getCurrency(), null);
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }else{
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status",jsonObject_tmp.get("status"))
                        .put("error", jsonObject_tmp.get("error"))
                        .put("message", "Failed to Update Password");

                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }

        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status","400")
                .put("message","Failed to Update Password");

        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

    }

    //api update user information
    @RequestMapping(value = "/account-settings/update", method = RequestMethod.POST)
    public Object updateAccount(@RequestBody MultiValueMap<String, String> paraMap,
                                HttpServletRequest request,
                                HttpSession session,
                                HttpServletResponse response) throws Exception {

        System.out.println("========================="+paraMap);
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);
        if(tokenKey == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        if(tokenKey.getAccess_token() == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());

        user.setFirstName(String.valueOf(paraMap.get("firstName").get(0)));
        user.setLastName(String.valueOf(paraMap.get("lastName").get(0)));
        user.setPhone(String.valueOf(paraMap.get("phone").get(0)));
        user.setReceiveNews(Boolean.parseBoolean(paraMap.get("receiveNews").get(0)));
        if (!user.getEmail().equals(String.valueOf(paraMap.get("email").get(0)))) {
            user.setEmail(String.valueOf(paraMap.get("email").get(0)));
            httpClientToken.updateAccount(user, tokenKey.getAccess_token());
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status","200")
                    .put("message","Updated User Email Information")
                    .put("redirect",true);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
        }else{
            user.setUsername(String.valueOf(paraMap.get("username").get(0)));
            user = httpClientToken.updateAccount(user, tokenKey.getAccess_token());
            modelAndView.addObject("user", user);
            modelAndView.addObject("tokenKey", tokenKey.getAccess_token());
            modelAndView.setViewName("settings/account_settings :: #general-contact-info");

            return modelAndView;
        }

    }

    @RequestMapping(value = "/update/f2a-setting", method = RequestMethod.POST)
    public Object update2fa(@RequestParam("password") String password, HttpServletRequest request, HttpSession session) throws Exception {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);
        if(tokenKey == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if(tokenKey.getAccess_token() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user.getEmail() == null && user.getUsername() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        user.setPassword(password);
        tokenKey = httpClientToken.getToken(user, tokenKey);
        if(tokenKey == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        if(tokenKey.getAccess_token() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        user.setFa2(true);

        //update password call
        user = httpClientToken.updateAccount(user, tokenKey.getAccess_token());
        if(user.getEmail() == null){
            user.setFa2secret(httpClientToken.getF2aSecret(user.getUsername(), tokenKey.getAccess_token()));

        }else {
            user.setFa2secret(httpClientToken.getF2aSecret(user.getEmail(), tokenKey.getAccess_token()));
        }
        //respond of change and redirect to qr code page to scan
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("fa2_change",true).put("qrurl",userService.generateQRUrl(user));
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }

    @RequestMapping(value = "/update/f2a-setting/off", method = RequestMethod.POST)
    public Object turnOff2fa(@RequestParam("password") String password, HttpServletRequest request, HttpSession session) throws Exception {

//        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);
        if(tokenKey == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if(tokenKey.getAccess_token() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user.getEmail() == null && user.getUsername() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);        }
        user.setPassword(password);
        tokenKey = httpClientToken.getToken(user, tokenKey);

        if(tokenKey == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        if(tokenKey.getAccess_token() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }


        user.setFa2(false);

        //update password call
        user = httpClientToken.updateAccount(user, tokenKey.getAccess_token());
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "200").put("message", "Successful 2FA Change");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);

//        modelAndView.addObject("user", user);
//        modelAndView.addObject("tokenKey", tokenKey.getAccess_token());
//
//        modelAndView.setViewName("settings/account_settings :: #account-settings");
//
//        return modelAndView;
    }

    @RequestMapping(value = "/update/receive-news/on", method = RequestMethod.POST)
    public ModelAndView turnOnNews(HttpServletRequest request, HttpSession session) throws Exception {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        user.setReceiveNews(true);

        //update password call
        user = httpClientToken.updateAccount(user, tokenKey.getAccess_token());

        modelAndView.addObject("user", user);
        modelAndView.addObject("tokenKey", tokenKey.getAccess_token());

        modelAndView.setViewName("settings/account_settings :: #account-settings");

        return modelAndView;
    }
    @RequestMapping(value = "/update/receive-news/off", method = RequestMethod.POST)
    public ModelAndView turnOffNews(HttpServletRequest request, HttpSession session) throws Exception {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        user.setReceiveNews(false);

        //update password call
        user = httpClientToken.updateAccount(user, tokenKey.getAccess_token());

        modelAndView.addObject("user", user);
        modelAndView.addObject("tokenKey", tokenKey.getAccess_token());

        modelAndView.setViewName("settings/account_settings :: #account-settings");

        return modelAndView;
    }

    //updated api key list table
    @RequestMapping(value = "/update/api-key-list", method = RequestMethod.GET)
    public ModelAndView updateApiKeyList(HttpServletRequest request, HttpSession session) throws Exception {

        ModelAndView modelAndView = new ModelAndView();

        User user = new User();
        tokenKey = userService.getSessionInfo(request, session);

        user = httpClientToken.getUser(tokenKey.getAccess_token());
        String content = httpClientApiKey.getListOfKeys(tokenKey.getAccess_token());

        user.mapApiKeyContent(content);
        ArrayList<ApiKey> apiKeys = user.getApiKeyList();
        for (ApiKey apiKey: apiKeys) {
            apiKey.setTotalElements(httpClientApiKey.getApiTotalElements(tokenKey.getAccess_token(), apiKey.getApikey()));
        }
        user.setApiKeyList(apiKeys);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("profile/api_key_list::api_key_table");
        return modelAndView;
    }

    //deactivate api key
    @RequestMapping(value = "/deactivate/api-key", method = RequestMethod.POST)
    public Object deactivateApiKey(@RequestParam("password") String password,
                                   @RequestParam("apiKey") String apiKey,
                                   HttpServletRequest request,
                                   HttpSession session) throws Exception {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        if(tokenKey != null){
            if(tokenKey.getAccess_token() == null){
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("error",true).put("message","Session Expired");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Session Expired");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if(password == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Password Cannot Be Empty!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        user.setPassword(password);

        String deactivateContent = httpClientApiKey.deactivateApiKey(user, apiKey, tokenKey.getAccess_token());

        if(deactivateContent == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Deactivate API Key");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else {
            try {
                JSONObject jsonObject = new JSONObject(deactivateContent);

                if (jsonObject.has("status")) {
                    if ((Integer) jsonObject.get("status") == 403) {
                        return new ResponseEntity<Error>(new Error(jsonObject.getString("error")), HttpStatus.valueOf((Integer) jsonObject.get("status")));
                    } else if ((Integer) jsonObject.get("status") != 200) {
                        return new ResponseEntity<Error>(new Error(jsonObject.getString("error")), HttpStatus.valueOf((Integer) jsonObject.get("status")));
                    }else{
                        return new ResponseEntity<Object>(deactivateContent, HttpStatus.valueOf((Integer) jsonObject.get("status")));
                    }

                }else{
                    return new ResponseEntity<Object>(deactivateContent, HttpStatus.valueOf((Integer) jsonObject.get("status")));
                }

            } catch (JSONException err) {
                logger.error("Error", err.toString());
                return err.toString();
            }
        }

    }


    @RequestMapping(value = "/qrcode", method = RequestMethod.GET)
    public ModelAndView getQRCode(HttpServletRequest request,HttpServletResponse response, HttpSession session) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request,session);

        if(tokenKey != null){
            if(tokenKey.getAccess_token() == null){
                return new ModelAndView("redirect:/login");
            }
        }else{
            return new ModelAndView("redirect:/login");
        }

        User user = httpClientToken.getUser(tokenKey.getAccess_token());
        if(user.getEmail() == null && user.getUsername() == null){
            return new ModelAndView("redirect:/login");
        }

        user.setFa2secret(httpClientToken.getF2aSecret(user.getEmail(), tokenKey.getAccess_token()));
        String qrurl = userService.generateQRUrl(user);
        userService.removeSessionInfo(response, session);
        modelAndView.addObject("qr", qrurl);
        modelAndView.setViewName("auth/qrcode");
        return modelAndView;
    }

    //authenticate user
    @RequestMapping(value = "/account-settings/authenticate", method = RequestMethod.POST)
    public Object authenticateUser(@RequestParam("email") String email, @RequestParam("password") String password) throws IOException {

        User user = new User();
        user.setEmail(email);
        user.setPassword(password);

        String content = httpClientToken.checkCredentials(email, password);

        if (content != null && new JSONObject(content).has("status")) {
            JSONObject jsonObject1 = new JSONObject(content);
            if (jsonObject1.get("status").equals(200)) {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Successfully Authenticated");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            } else {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("error", true).put("message", "Session Expired");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error", true).put("message", "Failed to Check Credentials");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
    }
}
