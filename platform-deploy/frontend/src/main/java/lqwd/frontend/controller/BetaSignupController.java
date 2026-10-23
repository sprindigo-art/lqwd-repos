package lqwd.frontend.controller;

import lqwd.frontend.captcha.CaptchaServiceV3;
import lqwd.frontend.captcha.ICaptchaService;
import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.BetaSignup;
import lqwd.frontend.model.BitcoinPrice;
import lqwd.frontend.model.Mail;
import lqwd.frontend.model.User;
import lqwd.frontend.repository.BetaSignupRepository;
import lqwd.frontend.service.MailService;
import lqwd.frontend.service.UserService;
import net.bytebuddy.utility.RandomString;
import org.jboss.aerogear.security.otp.Totp;
import org.jboss.aerogear.security.otp.api.Base32;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.ModelAndView;

import javax.mail.MessagingException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import javax.validation.Valid;
import java.io.UnsupportedEncodingException;
import java.util.Map;

@Controller
public class BetaSignupController {

    private static Logger logger = LoggerFactory.getLogger(lqwd.frontend.controller.BetaSignupController.class);

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

    @Autowired
    BetaSignupRepository betaSignupRepository;

    @Autowired
    private MailService mailService;

    @Autowired
    private Environment environment;

    @Autowired
    private ICaptchaService captchaServiceV3;



    @RequestMapping(value = "/beta", method = RequestMethod.GET)
    public ModelAndView betaLandingPage(HttpSession session, HttpServletRequest request, HttpServletResponse response) {

        ModelAndView modelAndView = new ModelAndView();
        modelAndView.setViewName("signup/signup_page-light");
        return modelAndView;
    }

    @RequestMapping(value = "/beta/add-subscriber", method = RequestMethod.POST)
    public Object addSubscriber(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                @RequestParam("email") String email) throws MessagingException {

        final String captchaResponse = request.getParameter("captchaResponse");
        boolean isVerified = captchaServiceV3.processResponse(captchaResponse,
                CaptchaServiceV3.SUBSCRIBE_BETA_ACTION);

        if (!isVerified)
            return new ResponseEntity<>(new Error("{\"error\":\"Bad Request\",\"error_description\":\"reCaptcha verification failed, please try again later\"}"), HttpStatus.BAD_REQUEST);


        BetaSignup betaSignup = new BetaSignup();
        betaSignup.setEmail(email);
        betaSignup.setInvite_code(RandomString.make(24));

        betaSignup  = betaSignupRepository.save(betaSignup);

        if(betaSignup != null) {
            String message = String.format("There is a new signup for beta, email: %s and invite code: %s, invite url: %s",
                    email, betaSignup.getInvite_code(), request.getRequestURL().toString().split(request.getRequestURI())[0] + "/beta-signup?invite=" + betaSignup.getInvite_code());

            mailService.sendMail("albert@lqwd.money", message, "New beta signup", null);

            Mail mail = new Mail();
            mail.setFrom("info@lqwd.money");
            mail.setMailTo(betaSignup.getEmail());
            mail.setSubject("Thank You For Subscribing!");
            Map<String, Object> model = new HashMap<String, Object>();
            mail.setProps(model);
            mailService.sendEmail(mail);

            return new ResponseEntity<>("{\"status\":\"200\"}", HttpStatus.OK);
        }else{
            return new ResponseEntity<>("{\"status\":\"400\"}", HttpStatus.BAD_REQUEST);
        }
    }

    @RequestMapping(value = {"/registration","/beta-signup", "/signup"}, method = RequestMethod.GET)
    public Object betaSignupView(@RequestParam(value = "invite", required = false) String invite, HttpSession session, HttpServletRequest request, HttpServletResponse response) {

        ModelAndView modelAndView = new ModelAndView();
        Integer totalRegistered = Integer.valueOf(environment.getProperty("beta.total_registered"));
        logger.info(String.valueOf(totalRegistered));
        Integer numberSpotsAvailable = 0;

        String content = httpClientToken.getNumberRegistered();
        logger.info(content);
        if (content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("status") && jsonObject.get("status").equals(200)) {
                numberSpotsAvailable = totalRegistered - jsonObject.getInt("data");
            }
        }

        modelAndView.addObject("spotsAvailable", numberSpotsAvailable);
        modelAndView.addObject("invite", invite);
        modelAndView.setViewName("beta-page/beta-registration");
        return modelAndView;
    }

    @RequestMapping(value = "/beta-invites", method = RequestMethod.GET)
    public ModelAndView getInvites(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);

        if(user == null){
            return new ModelAndView("redirect:/login");
        }

        if(user.getEmail().contains("@lqwd.money") && user.isEmailstatus()) {
            List<BetaSignup> betaSignupList = (List<BetaSignup>) betaSignupRepository.findAll();
            modelAndView.addObject("signups", betaSignupList);
            modelAndView.setViewName("beta-page/beta_list_invites");
            return modelAndView;
        }else{
            return new ModelAndView("redirect:/");
        }
    }


    @RequestMapping(value = "/beta/signup", method = RequestMethod.POST)
    public Object signupForBeta(@RequestParam("username") String username,
                                @RequestParam(value = "lastname", required = false) String lastname,
                                @RequestParam(value = "firstname", required = false) String firstname,
                                @RequestParam("email") String email,
                                @RequestParam("password") String  password,
                                @RequestParam(value = "invite_code", required = false) String invite_code,
                                HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        JSONObject jsonObject = new JSONObject();

        final String captchaResponse = request.getParameter("captchaResponse");
        boolean isVerified = captchaServiceV3.processResponse(captchaResponse,
                CaptchaServiceV3.REGISTER_ACTION);

        if (!isVerified)
            return new ResponseEntity<>(new Error("{\"error\":\"Bad Request\",\"error_description\":\"reCaptcha verification failed, please try again later\"}"), HttpStatus.BAD_REQUEST);

        User user = new User(username, email, password, firstname, lastname);
        user.setFa2(false);

        logger.info(user.toString());
        if(user.getEmail() == null || user.getEmail().equals("") || user.getUsername() == null || user.getUsername().equals("") || user.getPassword() == null || user.getPassword().equals("")){
            jsonObject.put("error", true).put("message", "Failed to Register User");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.NOT_ACCEPTABLE);
        }

        //for invite code usage
        if (invite_code != null) {
            //check invite code business end as well
            String code_check = httpClientToken.checkBusinessRegistrationCode(user.getEmail(), invite_code);
            JSONObject jsonObject1 = new JSONObject(code_check);

            //check invite code before attempting to save user
            BetaSignup betaSignup = betaSignupRepository.findUserByEmail(user.getEmail());

            if (betaSignup == null && !jsonObject1.get("status").equals(200)) {
                if (jsonObject1.has("message")) {
                    jsonObject.put("error", true).put("message", jsonObject1.get("message"));
                } else {
                    jsonObject.put("error", true).put("message", "Please Register with Email Used to Receive Invite Code");
                }
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.NOT_ACCEPTABLE);
            }


            if (betaSignup != null) {
                if (!betaSignup.getInvite_code().equals(invite_code) && !jsonObject1.get("status").equals(200)) {
                    if (jsonObject1.has("message")) {
                        jsonObject.put("error", true).put("message", jsonObject1.get("message"));
                        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.NOT_ACCEPTABLE);
                    } else {
                        jsonObject.put("error", true).put("message", "Invite Code is Not Valid");
                        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.NOT_ACCEPTABLE);
                    }
                }
            }

        }

        //save user after creation
        String savedUser = httpClientToken.registerUser(user);
        logger.info(savedUser);
        JSONObject savedUserJson = new JSONObject(savedUser);
        if(savedUserJson.has("error") && !savedUserJson.isNull("error")) {
            String error = "null";
            error = savedUserJson.getString("error");
            JSONObject jsonObject_error = new JSONObject(error);
            logger.error(error);
            return new ResponseEntity<>(jsonObject_error.toString(), HttpStatus.NOT_ACCEPTABLE);
        }

        if(savedUser == null){
            logger.error("LoginController:/registration -> Unable to Save User");
            jsonObject.put("error", true).put("message", "Failed to Register User");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.NOT_ACCEPTABLE);

        }else{
            tokenKey = tokenKey.mapContent(savedUser);

            if(tokenKey != null){
                if(tokenKey.getAccess_token() == null){
                    jsonObject.put("error", true).put("message", "Unable to Save Session");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.NOT_ACCEPTABLE);
                }
            }else{
                jsonObject.put("error", true).put("message", "Unable to Save Session");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.NOT_ACCEPTABLE);
            }
            user = httpClientToken.getUser(tokenKey.getAccess_token());
            user.setFa2secret(Base32.random());
            httpClientToken.setF2aSecret(user, tokenKey.getAccess_token());

            user.setFa2(false);
            httpClientToken.updateAccount(user, tokenKey.getAccess_token());
            String qr_url = userService.generateQRUrl(user);

            String qr_text = user.getFa2secret();

            jsonObject.put("error", false)
                    .put("qrcode", true)
                    .put("qr_url", qr_url)
                    .put("qr", qr_text);

            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
        }
    }

    @RequestMapping(value = "/beta/check-code", method = RequestMethod.POST)
    public Object checkQRCode(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                              @RequestParam("email") String email,
                              @RequestParam("password") String password,
                              @RequestParam("code") String code) throws IOException {

        String f2asecret = null;
        User user = new User();
        user.setEmail(email);
        user.setPassword(password);


        f2asecret = httpClientToken.getF2aSecret(user.getEmail(), tokenKey.getAccess_token());
        Totp totp = new Totp(f2asecret);

        if (!userService.isValidLong(code) || !totp.verify(code)) {
            //if code is incorrect respond with error
            logger.error("Code Was Incorrect");
            return new ResponseEntity<>(new Error("{\"error\":\"Bad Request\",\"error_description\":\"Incorrect Code\"}"), HttpStatus.FAILED_DEPENDENCY);
        }

        tokenKey = httpClientToken.getToken(user, tokenKey);
        user.setFa2(true);
        httpClientToken.updateAccount(user, tokenKey.getAccess_token());

        userService.saveSessionInfo(response, session, tokenKey, null, null);
        return new ResponseEntity<>(new Error("{\"status\":\"200\",\"message\":\"Success\"}"), HttpStatus.OK);
    }

    @RequestMapping(value = "/check-availability", method = RequestMethod.GET)
    public Object checkRegistrationAvailable(HttpSession session, HttpServletRequest request, HttpServletResponse response){
        String content = httpClientToken.getNumberRegistered();
        if (content != null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("status") && jsonObject.get("status").equals(200)) {
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }else{
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "Failed to Get Number of Spots Left");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
    }
}
