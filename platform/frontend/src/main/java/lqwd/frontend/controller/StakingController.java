package lqwd.frontend.controller;

import com.lowagie.text.DocumentException;
import lqwd.frontend.httpclient.*;
import lqwd.frontend.model.LndAddress;
import lqwd.frontend.model.LndNode;
import lqwd.frontend.model.Staking;
import lqwd.frontend.model.User;
import lqwd.frontend.service.PdfExportService;
import lqwd.frontend.service.UserService;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.io.IOUtils;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.ModelAndView;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;
import org.xhtmlrenderer.pdf.ITextRenderer;

import javax.servlet.ServletContext;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.awt.print.Pageable;
import java.io.ByteArrayInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.*;
import java.text.SimpleDateFormat;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Controller
public class StakingController {
    private static Logger logger = LoggerFactory.getLogger(StakingController.class);

    @Autowired
    private UserService userService;

    @Autowired
    private TokenKey tokenKey;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;

    @Autowired
    HttpClientStaking httpClientStaking;

    @Autowired
    HttpClientApiKey httpClientApiKey;
    @Autowired
    PdfExportService pdfExportService;

    @Value("${app.staking_min_amount}")
    private int minAmount;

    @RequestMapping(value = "/staking-request", method = RequestMethod.GET)
    public ModelAndView getStakingRequestPage(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                              @RequestParam Optional<Integer> page,
                                              @RequestParam(required = false, defaultValue = "10", value = "size") int size,
                                              @RequestParam(required = false, value = "status") String status,
                                              @RequestParam Optional<String> query) throws IOException, NullPointerException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);

        if (user == null || !user.getRole_s().contains("STAKING")) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());

        if (lndNodes != null) {
            user.setLndNodes(lndNodes);
        }
        modelAndView.addObject("lndNodes", lndNodes);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("staking/staking-request");
        return modelAndView;
    }
    @RequestMapping(value = "/update-last-ten-transactions", method = RequestMethod.GET)
    public ModelAndView getStakingLastTenTransactionsPage(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                              @RequestParam Optional<Integer> page,
                                              @RequestParam(required = false, defaultValue = "10", value = "size") int size,
                                              @RequestParam(required = false, value = "status") String status,
                                              @RequestParam Optional<String> query) throws IOException, NullPointerException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null || !user.getRole_s().contains("STAKING")) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        String content = httpClientStaking.getListOfStakingRequests(tokenKey.getAccess_token(), page, size, status, query);
        ArrayList<Staking> stakingList = new ArrayList<>();
        if (content != null) {
            Staking staking = new Staking();
            stakingList = staking.mapListStaking(content);
        }
        logger.info(stakingList.toString());
        modelAndView.addObject("stakingList", stakingList);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("staking/fragments/lastTenTransactions");
        return modelAndView;
    }
    @RequestMapping(value = "/staking-lists", method = RequestMethod.GET)
    public ModelAndView getStakingListPage(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, NullPointerException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null || !user.getRole_s().contains("STAKING")) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        modelAndView.addObject("user", user);
        modelAndView.setViewName("staking/staking-lists");
        return modelAndView;
    }

    @RequestMapping(value = "/staking-list-page", method = RequestMethod.GET)
    public ModelAndView getStakingListPageWithParams(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                                     @RequestParam(value = "page") Optional<Integer> pageNum,
                                                     @RequestParam(required = false, defaultValue = "10", value = "size") int size,
                                                     @RequestParam(required = false, value = "status") String status,
                                                     @RequestParam Optional<String> query,
                                                     @RequestParam (required = false, defaultValue = "1", value = "startPageIndex") int startPageIndex,
                                                     @RequestParam (required = false, defaultValue = "5", value = "endPageIndex") int endPageIndex,
                                                     @RequestParam (required = false, defaultValue = "false", value = "updatePageSet") boolean updatePageSet) throws IOException, NullPointerException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null || !user.getRole_s().contains("STAKING")) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        String content = httpClientStaking.getListOfStakingRequests(tokenKey.getAccess_token(), pageNum, size, status, query);

        ArrayList<Staking> stakingList = new ArrayList<>();
        if (content != null) {
            Staking staking = new Staking();
            stakingList = staking.mapListStaking(content);
        }
        if (status.equals("REQUESTED")) {
            modelAndView.setViewName("staking/fragments/list-requested");
        } else if (status.equals("APPROVED")) {
            modelAndView.setViewName("staking/fragments/list-approved");
        } else if (status.equals("ACTIVE")) {
            modelAndView.setViewName("staking/fragments/list-active");
        } else if (status.equals("DELETED")) {
            modelAndView.setViewName("staking/fragments/list-deleted");
        }
        JSONObject jsonObj = new JSONObject(content);
        int total = jsonObj.getJSONObject("data").getInt("total");
        int totalPages = (int) Math.ceil((double)total / size);
        if(updatePageSet){
            if (endPageIndex >= totalPages){
                endPageIndex = totalPages;
            }

        }
        if(totalPages <= 5) {
            startPageIndex = 1;
            endPageIndex = totalPages;
        }
        modelAndView.addObject("startPageIndex",startPageIndex);
        modelAndView.addObject("endPageIndex",endPageIndex);
        modelAndView.addObject("curentPage", pageNum.get());
        modelAndView.addObject("totalItems", total);
        modelAndView.addObject("totalPages", totalPages);
        modelAndView.addObject("stakingList", stakingList);

        return modelAndView;
    }

    @RequestMapping(value = "/create-staking-request", method = RequestMethod.POST)
    public Object createStakingRequest(@RequestParam(value = "amount") int amount,
                                       @RequestParam(value = "num_days") int num_days,
                                       @RequestParam(value = "payment_type") String payment_type,
                                       String password,
                                       HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if (!user.getRole_s().contains("STAKING")) {
            // userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Request failed");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        user.setPassword(password);
        tokenKey = httpClientToken.getToken(user, tokenKey);
        user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            //  userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Password Incorrect");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        //check for minimum amount
        if (amount < minAmount){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "The minimum amount must be 20000 SAT");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        Staking staking = new Staking();
        staking.setAmount(amount);
        staking.setTotalDays(num_days);
        staking.setType(payment_type);

        String content = httpClientStaking.stakingRequest(staking, tokenKey.getAccess_token(), user);
        if (content == null) {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error", true).put("message", "Failed to Request Staking");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String address = "";
        JSONObject jsonObj = new JSONObject(content);
        if (jsonObj.getJSONObject("data").has("btcAddress")) {
            address = jsonObj.getJSONObject("data").getString("btcAddress");

        } else if (jsonObj.getJSONObject("data").has("invoicePaymentRequest")) {
            address = jsonObj.getJSONObject("data").getString("invoicePaymentRequest");

        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "200").put("message", "Staking request was Successful!")
                .put("address", address);
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }
    @RequestMapping(value = "/staking-request-renew", method = RequestMethod.POST)
    public Object renewStakingRequest(@RequestParam(value = "paymentRequest") String paymentRequest,
                                       @RequestParam(value = "num_days") int num_days,
                                       @RequestParam(value ="type") String type,
                                       @RequestParam(value ="password") String password,
                                       HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if (!user.getRole_s().contains("STAKING")) {
            // userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Request failed");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        user.setPassword(password);
        tokenKey = httpClientToken.getToken(user, tokenKey);
        user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            //  userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Password Incorrect");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String content = null;

       content = httpClientStaking.stakingRenewRequest(paymentRequest, tokenKey.getAccess_token(),num_days,type,password);

        if (content != null) {
            JSONObject jsonObj = new JSONObject(content);
            if (jsonObj.get("status").equals(200)) {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Staking request was Successful!");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            } else {
                if(!jsonObj.getString("message").isEmpty()){
                    JSONObject jsonObject = new JSONObject();
                    jsonObject.put("error", true).put("message", jsonObj.getString("message"));
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
                }
            }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", true).put("message", "Failed to Renew Staking Request");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
    }
    @RequestMapping(value = "/staking-request-withdraw", method = RequestMethod.POST)
    public Object withdrawStakingRequest(@RequestParam(value = "paymentRequest") String paymentRequest,
                                         @RequestParam(value ="type") String type,
                                      @RequestParam(value = "password") String password,
                                      HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if (!user.getRole_s().contains("STAKING")) {
            // userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Request failed");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        user.setPassword(password);
        tokenKey = httpClientToken.getToken(user, tokenKey);
        user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            //  userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Password Incorrect");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String content = null;

         content = httpClientStaking.stakingWithdrawRequest(paymentRequest, tokenKey.getAccess_token(),type,password);

        if (content != null) {
            JSONObject jsonObj = new JSONObject(content);
            if (jsonObj.get("status").equals(200)) {
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Withdraw request was Successful! We will contact you shortly");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            } else {
                if(!jsonObj.getString("message").isEmpty()){
                    JSONObject jsonObject = new JSONObject();
                    jsonObject.put("error", true).put("message", jsonObj.getString("message"));
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
                }
            }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", true).put("message", "Failed to Request Withdrawal");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
    }
    @RequestMapping(value = "/staking-list-page-export-csv")
    public void getStakingListPageExportCsv(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                                     @RequestParam(value = "page") Optional<Integer> page,
                                                     @RequestParam(required = false, defaultValue = "10", value = "size") int size,
                                                     @RequestParam(required = false, value = "status") String status,
                                                     @RequestParam Optional<String> query) throws IOException, NullPointerException {
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        String content = httpClientStaking.getListOfStakingRequests(tokenKey.getAccess_token(), page, size, status, query);

        ArrayList<Staking> stakingList = new ArrayList<>();
        if (content != null) {
            Staking staking = new Staking();
            stakingList = staking.mapListStaking(content);
        }
        JSONObject jsonObj = new JSONObject(content);
        int total = jsonObj.getJSONObject("data").getInt("total");
        SimpleDateFormat simpleDateFormat = new SimpleDateFormat("dd-MMM-yyyy");
        String requestString = null;
        response.setContentType("text/csv");
        response.addHeader("Content-Disposition","attachment; filename=\"stakingRequestsReport.csv\"");
        try(CSVPrinter csvPrinter = new CSVPrinter(response.getWriter(), CSVFormat.DEFAULT)) {
            csvPrinter.printRecord("Address/Invoice", "Type", "Amount", "Status", "Created Date","Total Days","Left Days");
            for (Staking stakingItem : stakingList) {
                if(stakingItem.getType().equals("INVOICE")){
                   requestString = stakingItem.getPaymentRequest();
                } else {
                    requestString = stakingItem.getAddress();
                }
                csvPrinter.printRecord(requestString, stakingItem.getType(), stakingItem.getAmount(),stakingItem.getStatus(),simpleDateFormat.format(stakingItem.getDateCreated()), stakingItem.getTotalDays(), stakingItem.getDaysLeft());
            }
            csvPrinter.printRecord("Total number of requests", total);
        } catch (IOException e) {
            logger.error("Error occurs while writing csv file ", e);
        }
    }
    @RequestMapping(value = "/staking-list-page-export-pdf", method = RequestMethod.GET)
    public void getStakingListPageExportPdf(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                            @RequestParam(value = "page") Optional<Integer> pageNum,
                                            @RequestParam(required = false, defaultValue = "10", value = "size") int size,
                                            @RequestParam(required = false, value = "status") String status,
                                            @RequestParam Optional<String> query) throws IOException, NullPointerException{
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        String content = httpClientStaking.getListOfStakingRequests(tokenKey.getAccess_token(), pageNum, size, status, query);

        ArrayList<Staking> stakingList = new ArrayList<>();
        if (content != null) {
            Staking staking = new Staking();
            stakingList = staking.mapListStaking(content);
        }

        JSONObject jsonObj = new JSONObject(content);
        int total = jsonObj.getJSONObject("data").getInt("total");
        int totalPages = (int) Math.ceil((double)total / size);
        Map<String, Object> data = new HashMap<>();
        data.put("stakingList",stakingList);
        data.put("totalItems",total);
        data.put("pageNum", pageNum.get());
        data.put("totalPages",totalPages);
        data.put("size",size);

        ByteArrayInputStream exportedData = pdfExportService.generatePdfFile("staking/staking-report", data);
        response.setContentType("application/octet-stream");
        response.setHeader("Content-Disposition", "attachment; filename=reportStakingRequests.pdf");
        IOUtils.copy(exportedData, response.getOutputStream());

    }
}
