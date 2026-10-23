package lqwd.frontend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.*;
import lqwd.frontend.service.UserService;
import org.bouncycastle.cert.ocsp.Req;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
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
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URISyntaxException;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;

@Controller
public class PaymentController {

    private static Logger logger = LoggerFactory.getLogger(PaymentController.class);

    @Autowired
    private UserService userService;

    @Autowired
    private TokenKey tokenKey;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    HttpClientLnd httpClientLnd;

    //get create invoice view
    @RequestMapping(value="/payments", method = RequestMethod.GET)
    public ModelAndView getPaymentView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        String lndNameSession = userService.getSessionLnd(session);
        LndNode lndNode = new LndNode();
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        logger.info(lndNodes.toString());
        for (LndNode lndNodeTemp : lndNodes) {
           if(lndNodeTemp.getLndNodeName().equals(lndNameSession)){
                lndNode = lndNodeTemp;
           }
        }
        user.setCurrency(userService.getSessionCurrency(session));
        ArrayList<Transaction> transactions = new ArrayList<>();
        ArrayList<Payment> payments = new ArrayList<>();

        //get list of transactions and list of invoices to display
        modelAndView.addObject("lndNodeSession",lndNode);
        modelAndView.addObject("payments", payments);
        modelAndView.addObject("transactions", transactions);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("payment/payment");

        return modelAndView;
    }

    // get transactions for payment page
    @RequestMapping(value = "/get-transactions-frag", method = RequestMethod.GET)
    public ModelAndView getTransactionsFragment(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, URISyntaxException {
        ModelAndView modelAndView = new ModelAndView();

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return null;
        }
        user.setCurrency(userService.getSessionCurrency(session));

        ArrayList<Transaction> transactions = new ArrayList<>();
        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        user.setLndNodes(lndNodes);
        if(lndNodes != null){
            for (LndNode lndNode: lndNodes) {
                ArrayList<Transaction> transactions_tmp = new ArrayList<>();
                transactions_tmp = httpClientLnd.getAllTransactionsByNode(tokenKey.getAccess_token(), lndNode.getLndNodeName(), userService.getSessionCurrency(session), userService.getBTCPrice());
                if (transactions_tmp != null){
                    transactions.addAll(transactions_tmp);
                }
            }
        }
        modelAndView.addObject("transactions", transactions);
        //get list of transactions and list of invoices to display
        modelAndView.addObject("user", user);
        modelAndView.setViewName("payment/fragments/transactions::transactionsFrag");

        return modelAndView;
    }


    @RequestMapping(value = "/send-payment", method = RequestMethod.POST)
    public Object sendPayment(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                              @RequestParam(value = "lnd_name", required = false) String lnd_name,
                              @RequestParam("pay_req") String pay_req,
                              @RequestParam("password") String password,
                              @RequestParam(value = "passphrase", required = false) String passphrase,
                              @RequestParam(value = "amount", required = false) String amount) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else{
            user.setPassword(password);
            tokenKey = httpClientToken.getToken(user, tokenKey);
            if (tokenKey.getAccess_token() == null){
                userService.removeSessionInfo(response, session);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "400").put("message", "Failed to Authenticate, Password Incorrect");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        lnd_name = userService.getSessionLnd(session);
        String content = httpClientLnd.getPaymentDetails(tokenKey.getAccess_token(), lnd_name, pay_req);

        if(content == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Get Payment Details");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        Payment payment = new Payment();
        payment = payment.mapContent(content);
        content = httpClientLnd.sendPayment(tokenKey.getAccess_token(), lnd_name, pay_req,  payment.getDestination(), passphrase);

        if(content == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Send Payment");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        JSONObject jsonObject = new JSONObject(content);
        if(jsonObject.has("error")){
            String error = jsonObject.getString("error");
            jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message", error);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if(jsonObject.has("status")){
            if(!jsonObject.get("status").equals(200)){
               JSONObject jsonObjectToJs = new JSONObject();
                jsonObjectToJs.put("error",true).put("message", jsonObject.getString("message"));
                return new ResponseEntity<>(jsonObjectToJs.toString(), HttpStatus.BAD_REQUEST);
            }

        }
        if(jsonObject.has("payment_error")){
            if(!jsonObject.get("payment_error").equals("")){
                String error = jsonObject.getString("payment_error");
                jsonObject = new JSONObject();
                jsonObject.put("error",true).put("message", error);
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            } else {
                jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Successfully Sent Payment");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }

        }
        //get destination based on payment details
        //then supply destination pay-req amount lnd_name and pubkey
        jsonObject = new JSONObject();
        jsonObject.put("status", "200").put("message", "Successfully Sent Payment");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }


    @RequestMapping(value = "/send-btc-payment", method = RequestMethod.POST)
    public Object sendBtcPayment(HttpSession session, HttpServletRequest request, HttpServletResponse response,
//                              @RequestParam("lnd_name") String lnd_name,
                                 @RequestParam("btc_address") String btcAddress,
                                 @RequestParam("password") String password,
                                 @RequestParam(value = "passphrase", required = false) String passphrase,
                                 @RequestParam("amount") String amount) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else{
            user.setPassword(password);
            tokenKey = httpClientToken.getToken(user, tokenKey);
            if (tokenKey.getAccess_token() == null){
                userService.removeSessionInfo(response, session);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "400").put("message", "Failed to Authenticate, Password Incorrect");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        String lnd_name = userService.getSessionLnd(session);
        if (lnd_name == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Send Payment, Please select the node!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        String content = httpClientLnd.sendBtcPayment(tokenKey.getAccess_token(), lnd_name,  amount, btcAddress, passphrase);
        logger.info("from sendBtcPayment");

        if(content == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Send BTC Payment");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        logger.info(content.toString());
        JSONObject jsonObject = new JSONObject(content);
        if(jsonObject.has("error")){
            String error = jsonObject.getString("error");
            jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message", error);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if(jsonObject.has("status")){
            if(!jsonObject.get("status").equals(200)){
                JSONObject jsonObjectToJs = new JSONObject();
                jsonObjectToJs.put("error",true).put("message", jsonObject.getString("message"));
                return new ResponseEntity<>(jsonObjectToJs.toString(), HttpStatus.BAD_REQUEST);
            }

        }
        //get destination based on payment details
        //then supply destination pay-req amount lnd_name and pubkey
        jsonObject = new JSONObject();
        jsonObject.put("status", "200").put("message", "Successfully Sent BTC Payment");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }


    @RequestMapping(value = "/send-keysend-payment", method = RequestMethod.POST)
    public Object sendKeysendPayment(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                              @RequestParam("value") String value,
                              @RequestParam("pubkey") String pubkey,
                              @RequestParam("password") String password,
                              @RequestParam(value = "passphrase", required = false) String passphrase) throws IOException, NoSuchAlgorithmException, InvalidKeyException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }else{
            user.setPassword(password);
            tokenKey = httpClientToken.getToken(user, tokenKey);
            if (tokenKey.getAccess_token() == null){
                userService.removeSessionInfo(response, session);
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status", "400").put("message", "Failed to Authenticate, Password Incorrect");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        String lnd_name = userService.getSessionLnd(session);
        String content = null;
        content = httpClientLnd.sendKeysendPayment(tokenKey.getAccess_token(), lnd_name, value,  pubkey, passphrase);
        logger.info(content);
        if(content == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Send Payment");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        JSONObject jsonObject = new JSONObject(content);
        if(jsonObject.has("error")){
            String error = jsonObject.getString("error");
            jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message", error);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        if(jsonObject.has("status")){
            if(!jsonObject.get("status").equals(200)){
                JSONObject jsonObjectToJs = new JSONObject();
                jsonObjectToJs.put("error",true).put("message", jsonObject.getString("message"));
                return new ResponseEntity<>(jsonObjectToJs.toString(), HttpStatus.BAD_REQUEST);
            }

        }
        if(jsonObject.has("payment_error")){
            if(!jsonObject.get("payment_error").equals("")){
                String error = jsonObject.getString("payment_error");
                jsonObject = new JSONObject();
                jsonObject.put("error",true).put("message", error);
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            } else {
                jsonObject = new JSONObject();
                jsonObject.put("status", "200").put("message", "Successfully Sent Payment");
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
            }

        }
        //get destination based on payment details
        //then supply destination pay-req amount lnd_name and pubkey
        jsonObject = new JSONObject();
        jsonObject.put("status", "200").put("message", "Successfully Sent Payment");
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }

    @RequestMapping(value = "/payment-lookup", method = RequestMethod.GET)
    public ModelAndView getPaymentLookUpView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("payment/payment-request");
        return modelAndView;
    }

    @RequestMapping(value = "/get-payment-details", method=RequestMethod.GET)
    public Object getPaymentRequestDetails(@RequestParam("pay_req") String pay_req,
                                                 @RequestParam(value = "json", required = false, defaultValue = "false") Boolean json,
                                                 HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();
        String content = null;
        Payment payment = new Payment();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "Failed to Authenticate, Session Expired Please Login!");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        //can be any node for this call
        if(lndNodes == null || lndNodes.isEmpty()){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "No LND Nodes to Use for Payment Request Look Up");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);
        if (lnd_name == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", 400).put("message", "Failed to Get LND Session Name");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        content = httpClientLnd.getPaymentDetails(tokenKey.getAccess_token(), lnd_name, pay_req);
        if(content != null && httpClientLnd.isJson(content)){
            payment = payment.mapContent(content);
        }

        if (json){
            //return payment request details as json
            ObjectWriter ow = new ObjectMapper().writer().withDefaultPrettyPrinter();
            String payment_json = ow.writeValueAsString(payment);
            JSONObject jsonObject = new JSONObject(payment_json);
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
        }
        logger.info(payment.toString());
        modelAndView.addObject("payment", payment);
        modelAndView.setViewName("payment/fragments/payment-details");

        return modelAndView;

    }

    @RequestMapping(value = "/get-payreq-qrcode", method = RequestMethod.GET)
    public Object getAddressQrCode(@RequestParam("payreq") String payreq, HttpSession session, HttpServletRequest request, HttpServletResponse response) throws Exception {
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status","400").put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        BitMatrix bitMatrix = userService.generateAddressQrCode(payreq);

        ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream();
        MatrixToImageWriter.writeToStream(bitMatrix, "png", byteArrayOutputStream);
        byteArrayOutputStream.close();

        return new ResponseEntity<>(Base64.getEncoder().encode(byteArrayOutputStream.toByteArray()), HttpStatus.OK);
    }

    @RequestMapping(value = "/get-payments", method = RequestMethod.GET)
    public Object getPaymentListFragment(HttpSession session, HttpServletRequest request,HttpServletResponse response) throws IOException {

        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status","400").put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        ArrayList<Payment> payments = new ArrayList<>();
        ArrayList<LndNode> lndNodes = new ArrayList<>();
        Payment payment = new Payment();

        lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        if (!lndNodes.isEmpty()){
            for (LndNode lndNode: lndNodes) {
                String payment_content = httpClientLnd.getAllPaymentsByLnd(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                if (payment_content != null) {
                    ArrayList<Payment> payments_tmp = payment.mapPaymentList(payment_content, lndNode);
                    if (payments_tmp != null){
                        payments.addAll(payments_tmp);
                    }
                }
            }
        }

        if (!payments.isEmpty()){
            Collections.sort(payments, Payment::compareTo);

            modelAndView.addObject("user", user);
            modelAndView.addObject("payments", payments);
            modelAndView.setViewName("payment/fragments/payment-list");
            return modelAndView;
        }else{
            modelAndView.addObject("user", user);
            modelAndView.addObject("payments", null);
            modelAndView.setViewName("payment/fragments/payment-list");
            return modelAndView;
        }



    }

    @RequestMapping(value = "/get-fee-estimate", method = RequestMethod.POST)
    public Object getFeeEstimate(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                 @RequestParam(value = "payreq") String payreq,
                                 @RequestParam(value="amt") String amt,
                                 @RequestParam(value = "destination", required = false) String destination) throws IOException {

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status","400").put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String lnd_name = userService.getSessionLnd(session);
        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);
        ModelAndView modelAndView = new ModelAndView();
        Payment payment = new Payment();
        if (destination == null) {
            if (payreq != null) {
                String payreq_data = httpClientLnd.getPaymentDetails(tokenKey.getAccess_token(), lnd_name, payreq);
                if (payreq_data != null && httpClientLnd.isJson(payreq_data)) {
                    payment = payment.mapContent(payreq_data);
                    logger.info(payment.toString());
                    destination = payment.getDestination();
                    if (payment.getNum_satoshis() != null && payment.getNum_satoshis() != 0) {
                        amt = String.valueOf(payment.getNum_satoshis());
                    }
                }
            }
        }


        if (destination == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status","400").put("message","Could Not Look Up Route");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        payment.setDestination(destination);

        //get fee estimate
        String content = httpClientLnd.getFeeEstimate(tokenKey.getAccess_token(), lnd_name, destination, amt);
        logger.info("feeEstimateContent: "+content);
        if(content != null && httpClientLnd.isJson(content)) {

            JSONObject statusCheck = new JSONObject(content);
            if (statusCheck.has("status") && statusCheck.getInt("status") != 200){
                JSONObject jsonObject = new JSONObject();
                jsonObject.put("status",statusCheck.getInt("status")).put("message", statusCheck.get("error"));
                return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
            }

            FeeEstimate feeEstimate = new FeeEstimate();
            feeEstimate = feeEstimate.mapContent(content);

            for (PaymentHops paymentHops : feeEstimate.getPaymentHops()){
                JSONObject alias_json = new JSONObject(httpClientLnd.getNodeInfo(tokenKey.getAccess_token(), lnd_name, paymentHops.getPub_key()));
                String alias_lnd_name = null;

                if (alias_json.has("node") && alias_json.get("node") != null){
                    if (alias_json.getJSONObject("node").has("alias") && alias_json.getJSONObject("node").get("alias") != null) {
                        alias_lnd_name = alias_json.getJSONObject("node").getString("alias");
                        paymentHops.setAlias(alias_lnd_name);
                    }
                }
            }

            modelAndView.addObject("lnd_name", lnd_name);
            modelAndView.addObject("lndNode", lndNode);
            modelAndView.addObject("payreq", payreq);
            modelAndView.addObject("feeEstimate", feeEstimate);
            modelAndView.addObject("payment", payment);
//            modelAndView.setViewName("payment/fragments/send_invoice_payment::payment-lookup-card");
            modelAndView.setViewName("payment/fragments/fee-modal");
            return modelAndView;
//            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
        }else{
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status","400").put("message","Could Not Look Up Route");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
    }
}
