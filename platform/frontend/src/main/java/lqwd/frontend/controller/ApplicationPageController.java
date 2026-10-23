package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.BusinessApplication;
import lqwd.frontend.service.UserService;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import javax.validation.Valid;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Controller
public class ApplicationPageController {

    private static Logger logger = LoggerFactory.getLogger(ApplicationPageController.class);
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

    @RequestMapping(value = "/business-signup",method = RequestMethod.GET)
    public ModelAndView getBusinessSignupPage(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();

        modelAndView.setViewName("application_page/application_page-light");
        return modelAndView;
    }

    @RequestMapping(value = "/save-business", method = RequestMethod.POST)
    public Object saveBusiness(@Valid BusinessApplication businessApplication, BindingResult bindingResult) throws IOException {

        String content = null;

        if (bindingResult.hasErrors()){
            Map<String, String> errors = new HashMap<>();
            bindingResult.getAllErrors().forEach((error) -> {
                String fieldName = ((FieldError) error).getField();
                String errorMessage = error.getDefaultMessage();
                errors.put(fieldName, errorMessage);
            });
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("message", "Please Fill in Required Fields").put("errors", errors);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        content = httpClientToken.companyApplication(businessApplication);

        logger.info(content);
        if (content == null) {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error", true).put("message", "Failed to Create Business Application");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        JSONObject jsonCheck = new JSONObject(content);
        if (jsonCheck.has("status") && jsonCheck.get("status").equals(200)) {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error", false).put("message", "Successfully Created Business Application");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
        }else{
            if (jsonCheck.has("message")){
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("error", true).put("message", jsonCheck.get("message"));
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }

        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", true).put("message", "Failed to Create Business Application");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
    }
}