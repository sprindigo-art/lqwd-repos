package lqwd.frontend.controller;

import lqwd.frontend.captcha.CaptchaServiceV3;
import lqwd.frontend.captcha.ICaptchaService;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.User;
import lqwd.frontend.service.UserService;
import org.jboss.aerogear.security.otp.Totp;
import org.jboss.aerogear.security.otp.api.Base32;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.ModelMap;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import javax.validation.Valid;
import java.io.IOException;
import java.util.Locale;

@Controller
public class RegistrationController {

    private static Logger logger = LoggerFactory.getLogger(RegistrationController.class);

    @Autowired
    private UserService userService;

    @Autowired
    private TokenKey tokenKey;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;

    @Autowired
    private ICaptchaService captchaServiceV3;

    @RequestMapping(value="/registration-old", method = RequestMethod.GET)
    public ModelAndView registration(){
        ModelAndView modelAndView = new ModelAndView();
        User user = new User();
        modelAndView.addObject("user", user);
        modelAndView.setViewName("auth/registration");
        return modelAndView;
    }

    @RequestMapping(value = "/registration-old", method = RequestMethod.POST)
    public Object createNewUser(@Valid @ModelAttribute("user") User user,
                                      HttpServletRequest request,
                                      HttpServletResponse response,
                                      HttpSession session,
                                      BindingResult bindingResult) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        final String captchaResponse = request.getParameter("captchaResponse");
        boolean isVerified = captchaServiceV3.processResponse(captchaResponse,
                CaptchaServiceV3.REGISTER_ACTION);

        if (!isVerified)
            return new ResponseEntity<>(new Error("{\"error\":\"Bad Request\",\"error_description\":\"reCaptcha verification failed, please try again later\"}"), HttpStatus.BAD_REQUEST);


        if(user.getEmail() == null && user.getPassword() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Registration Failed");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        //save user after creation
        String savedUser = userService.saveUser(user);
        logger.info("Saved user: {}",savedUser);
        JSONObject jsonObject = new JSONObject(savedUser);

        if(jsonObject.has("error") && !jsonObject.isNull("error")) {
            String error = "null";
            error = jsonObject.getString("error");
            logger.error(error);
            JSONObject jsonErrorObject = new JSONObject();
            jsonErrorObject.put("error",true).put("message",error);
            return new ResponseEntity<>(jsonErrorObject.toString(), HttpStatus.FAILED_DEPENDENCY);
        }

        if(savedUser == null){
            logger.error("LoginController:/registration -> Unable to Save User");
            JSONObject jsonerrObject = new JSONObject();
            jsonerrObject.put("error",true).put("message","Unable to Save User");
            return new ResponseEntity<>(jsonerrObject.toString(), HttpStatus.BAD_REQUEST);

        }else{
            //User is using 2FA and will have scanned barcode
            //now redirect user to login again to use code
            tokenKey = tokenKey.mapContent(savedUser);

            if(tokenKey != null){
                if(tokenKey.getAccess_token() == null){
                    JSONObject jsonObj = new JSONObject();
                    jsonObj.put("error",true).put("message","Unable to Save Session");
                    return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
                }
            }else{
                JSONObject jsonObj = new JSONObject();
                jsonObj.put("error",true).put("message","Unable to Save Session");
                return new ResponseEntity<>(jsonObj.toString(), HttpStatus.BAD_REQUEST);
            }

            user.setFa2secret(Base32.random());
            httpClientToken.setF2aSecret(user, tokenKey.getAccess_token());

            user.setFa2(true);
            httpClientToken.updateAccount(user, tokenKey.getAccess_token());
            String qr_url = userService.generateQRUrl(user);
            JSONObject jsonObj = new JSONObject();
            jsonObj.put("qrcode", true).put("qr_url", qr_url);
            return new ResponseEntity<>(jsonObj.toString(), HttpStatus.OK);
        }
    }
}
