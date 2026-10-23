package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.*;
import lqwd.frontend.service.UserService;
import org.json.JSONObject;
import org.json.simple.parser.ParseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.ModelAndView;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Optional;

@Controller
public class RequestLiquidityController {
    private static Logger logger = LoggerFactory.getLogger(RequestLiquidityController.class);

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

    @Value("${app.liquidity_min_amount}")
    private int minLiquidityAmount;
    @Value("${app.liquidity_min_num_of_weeks}")
    private int minNumOfWeeks;

    @RequestMapping(value = "/request-liquidity", method = RequestMethod.GET)
    public ModelAndView getRequestLiquidity(HttpSession session, HttpServletRequest request,
                                            HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        modelAndView.addObject("user", user);

        modelAndView.setViewName("liquidity/request_liquidity");
       return modelAndView;
    }

    @RequestMapping(value = "/liquidity-list-page", method = RequestMethod.GET)
    public ModelAndView getLiquidityListPageWithParams(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                                     @RequestParam(value = "page", defaultValue = "1") int pageNum,
                                                     @RequestParam(required = false, defaultValue = "10", value = "size") int size,
                                                     @RequestParam (required = false, defaultValue = "1", value = "startPageIndex") int startPageIndex,
                                                     @RequestParam (required = false, defaultValue = "5", value = "endPageIndex") int endPageIndex,
                                                     @RequestParam (required = false, defaultValue = "false", value = "updatePageSet") boolean updatePageSet) throws IOException, NullPointerException {
        int totalItems = 0;
        int totalPages = 0;
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null || !user.getRole_s().contains("LIQUIDITY")) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        String content = httpClientToken.getLiquidityInvoices(tokenKey.getAccess_token(),--pageNum,size);

        ArrayList<LiquidityInvoice> liquidityInvoices = new ArrayList<>();
        JSONObject jsonObject = new JSONObject(content);
        if (jsonObject != null && jsonObject.get("status").equals(200)) {
            LiquidityInvoice liquidityInvoice = new LiquidityInvoice();
            liquidityInvoices = liquidityInvoice.mapListLiquidityInvoice(content);
            totalItems = jsonObject.getJSONObject("data").getInt("count");
            totalPages = (int) Math.ceil((double)totalItems / size);
            if (updatePageSet) {
                if (endPageIndex >= totalPages){
                    endPageIndex = totalPages;
                }
            }
            if(totalPages <= 5) {
                startPageIndex = 1;
                endPageIndex = totalPages;
            }
        }
        modelAndView.setViewName("liquidity/fragments/liquidity-table");
        modelAndView.addObject("startPageIndex",startPageIndex);
        modelAndView.addObject("endPageIndex",endPageIndex);
        modelAndView.addObject("curentPage", ++pageNum);
        modelAndView.addObject("totalItems", totalItems);
        modelAndView.addObject("totalPages", totalPages);
        modelAndView.addObject("liquidityInvoices", liquidityInvoices);

        return modelAndView;
    }

    @RequestMapping(value = "/get-liquidity-invoice-details", method = RequestMethod.GET)
    public ModelAndView getLiquidityInvoiceDetails(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                                     @RequestParam(value = "currentPage") int currentPage,
                                                     @RequestParam(value = "liquidityInvoice") Long paymentId) throws IOException, NullPointerException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null || !user.getRole_s().contains("LIQUIDITY")) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        String content = httpClientToken.getLiquidityInvoices(tokenKey.getAccess_token(),--currentPage,10);
        ArrayList<LiquidityInvoice> liquidityInvoices = new ArrayList<>();
        LiquidityInvoiceType invoice = new LiquidityInvoiceType();
        LiquidityBtcType liquidityBtcType = new LiquidityBtcType();
        JSONObject jsonObject = new JSONObject(content);
        if (jsonObject.get("status").equals(200)) {
            LiquidityInvoice liquidityInvoice = new LiquidityInvoice();
            liquidityInvoices = liquidityInvoice.mapListLiquidityInvoice(content);
            for(LiquidityInvoice liquidityInvoiceDetails: liquidityInvoices){
                if(liquidityInvoiceDetails.getPaymentOptionId().equals(paymentId)){
                    if(liquidityInvoiceDetails.getType().equals("INVOICE")) {
                        String invoicesContent = httpClientLnd.getLiquidityInvoiceDetailsById(tokenKey.getAccess_token(),currentPage,10);
                        ArrayList<LiquidityInvoiceType> invoices = invoice.mapInvoiceLiquidityList(invoicesContent);
                        for(LiquidityInvoiceType invoice1: invoices){
                            if(invoice1.getId().equals(paymentId)){
                                liquidityInvoiceDetails.setPaymentRequest(invoice1.getPaymentRequest());
                            }
                        }
                    } else {
                        String btcContent = httpClientLnd.getLiquidityBtcDetailsById(tokenKey.getAccess_token(),currentPage,10);
                        ArrayList<LiquidityBtcType> liquidityBtcTypeArrayList = liquidityBtcType.mapBtcLiquidityList(btcContent);
                        for(LiquidityBtcType addresstemp: liquidityBtcTypeArrayList){
                            if(addresstemp.getId().equals(paymentId)){
                                liquidityInvoiceDetails.setPaymentRequest(addresstemp.getWalletAddress());
                            }
                        }
                    }
                    modelAndView.addObject("liquidityInvoiceDetails", liquidityInvoiceDetails);
                }
            }
        }
        modelAndView.setViewName("liquidity/modals/liquidity_invoice_details");
        return modelAndView;
    }
    @RequestMapping(value = "/send-liquidity-request", method = RequestMethod.POST)
    public Object sendLiquidityRequest(@RequestParam(value = "pubkey") String pubkey,
                                       @RequestParam(value = "amount") int amount,
                                       @RequestParam(value = "numberOfWeeks") int numberOfWeeks,
                                       @RequestParam(value = "nodeAddress") String nodeAddress,
                                       @RequestParam(value = "type") String type,
                                       @RequestParam(value = "fee") String fee,
                                       HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);

        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        //check for minimum amount
        if (amount < minLiquidityAmount){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "The minimum amount must be 20000 SAT");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        //check for minimum number of weeks
        if (numberOfWeeks < minNumOfWeeks){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "The minimum number of weeks must be 2");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String content = httpClientLnd.sendRequestLiquidity(pubkey,amount,numberOfWeeks,nodeAddress,type,tokenKey.getAccess_token());
        logger.info(content);
        if (content!=null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.get("status").equals(200)) {
                jsonObject.put("invoice",jsonObject.getJSONObject("data").getString("paymentRequest"));
                jsonObject.put("fee",fee);
                jsonObject.put("status", "200").put("message", "Liquidity request was Successful!");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            } else {
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", true).put("message", "Failed to Request Liquidity");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

    }
    @RequestMapping(value = "/finalize-liquidity", method = RequestMethod.POST)
    public Object finalizeLiquidity(long liquidityId, HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        tokenKey = userService.getSessionInfo(request, session);
        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        String content = httpClientLnd.finalizeLiquidity(liquidityId,tokenKey.getAccess_token());

        if (content!=null && httpClientLnd.isJson(content)){
            JSONObject jsonObject = new JSONObject(content);
                if (jsonObject.get("status").equals(200)) {
                    jsonObject.put("status", "200").put("message", "Staking request was Successful!");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
                }
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("error", true).put("message", "Failed to Request Liquidity");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);

    }
}
