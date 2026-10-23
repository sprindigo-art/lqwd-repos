package lqwd.frontend.controller;

import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.*;
import lqwd.frontend.service.UserService;
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
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;

@Controller
public class TransactionHistoryController {

    private static Logger logger = LoggerFactory.getLogger(TransactionHistoryController.class);

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

    @RequestMapping(value = {"/transaction-history", "/payment-history", "/invoice-history"}, method = RequestMethod.GET)
    public ModelAndView getTransactionHistoryView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        //if lnd session not set redirect to profile
        String lnd_name = (String) session.getAttribute("lnd");
        if (lnd_name == null){
            return new ModelAndView("redirect:/profile");
        }

        //get invoices
        String invoice_content = httpClientLnd.getAllInvoicesPaginated(tokenKey.getAccess_token(), lnd_name, null, null, String.valueOf(50));

        //get page number page size and total for payments
        if (invoice_content != null && httpClientLnd.isJson(invoice_content)) {
            JSONObject jsonObject = new JSONObject(invoice_content);
            if (jsonObject.has("data") && jsonObject.get("data") != null) {
                ArrayList<Invoice> invoices = new Invoice().mapInvoiceListDB(invoice_content);
                JSONObject jsonObject1 = jsonObject.getJSONObject("data");
                modelAndView.addObject("invoicePageNumber", jsonObject1.getInt("pageNumber"));
                modelAndView.addObject("invoiceTotalPages", jsonObject1.getInt("totalPages"));
                modelAndView.addObject("invoicePageSize", jsonObject1.getInt("pageSize"));
                modelAndView.addObject("invoiceTotalItems", jsonObject1.getInt("total"));
                modelAndView.addObject("invoiceList", invoices);
            }
        }

        //get payments
        String payment_content = httpClientLnd.getAllPaymentsPaginated(tokenKey.getAccess_token(), lnd_name, null, String.valueOf(50), false);
        logger.info(payment_content);

        //get page number page size and total for payments
        if (payment_content != null && httpClientLnd.isJson(payment_content)) {
            JSONObject jsonObject = new JSONObject(payment_content);
            if (jsonObject.has("data") && jsonObject.get("data") != null) {
                ArrayList<Payment> payments = new Payment().mapPaymentList(payment_content);
                JSONObject jsonObject1 = jsonObject.getJSONObject("data");
                modelAndView.addObject("paymentPageNumber", jsonObject1.getInt("pageNumber"));
                modelAndView.addObject("paymentTotalPages", jsonObject1.getInt("totalPages"));
                modelAndView.addObject("paymentPageSize", jsonObject1.getInt("pageSize"));
                modelAndView.addObject("paymentTotalItems", jsonObject1.getInt("total"));
                modelAndView.addObject("paymentList", payments);
                logger.info(payments.toString());
            }
        }

        //get transactions
        String transaction_content = httpClientLnd.getAllTransactionsPaginated(tokenKey.getAccess_token(), lnd_name, null, String.valueOf(50));

        ArrayList<Transaction> transactions = new Transaction().mapTransactionList(transaction_content);

        //get page number page size and total for transaction
        if (transaction_content != null && httpClientLnd.isJson(transaction_content)) {
            JSONObject jsonObject = new JSONObject(transaction_content);
            if (jsonObject.has("data") && jsonObject.get("data") != null) {
                JSONObject jsonObject1 = jsonObject.getJSONObject("data");
                modelAndView.addObject("transactionPageNumber", jsonObject1.getInt("pageNumber"));
                modelAndView.addObject("transactionTotalPages", jsonObject1.getInt("totalPages"));
                modelAndView.addObject("transactionPageSize", jsonObject1.getInt("pageSize"));
                modelAndView.addObject("transactionTotalItems", jsonObject1.getInt("total"));
                modelAndView.addObject("transactionList", transactions);
                logger.info(transactions.toString());
            }
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("transaction_history/transaction-history");
        return modelAndView;
    }

    @RequestMapping(value = "/get-transaction-history", method = RequestMethod.POST)
    public Object getTransactionHistoryByLndNode(HttpSession session, HttpServletRequest request, HttpServletResponse response, @RequestParam(value = "lnd_name", required = false) String lnd_name) throws IOException {

        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        //create transaction history list
        ArrayList<TransactionHistory> transactionHistories = new ArrayList<>();

        ArrayList<LndNode> lndNodes = new ArrayList<>();

        if (lnd_name != null) {
            LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), lnd_name);
            lndNodes.add(lndNode);
        }else {
            lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        }


        for (LndNode lndNode: lndNodes) {
            String content = httpClientLnd.getNodeInfo(tokenKey.getAccess_token(), lndNode.getLndNodeName(), lndNode.getNodepubkey());
            if (content != null) {
                JSONObject alias_json = new JSONObject(content);

                String alias_lnd_name = null;

                if (alias_json.has("node") && alias_json.get("node") != null) {
                    if (alias_json.getJSONObject("node").has("alias") && alias_json.getJSONObject("node").get("alias") != null) {
                        alias_lnd_name = alias_json.getJSONObject("node").getString("alias");
                        lndNode.getLndNodeInfo().setAlias(alias_lnd_name);
                    }
                }
            }

            //get invoices created
            String invoice_content = httpClientLnd.getAllInvoices(tokenKey.getAccess_token(), lndNode.getLndNodeName());
//            logger.info(invoice_content);
            if (invoice_content != null) {
                ArrayList<TransactionHistory> transactionHistories1 = new TransactionHistory().mapInvoiceListHistory(invoice_content, lndNode);
                if (transactionHistories1 != null && !transactionHistories1.isEmpty()) {
                    transactionHistories.addAll(transactionHistories1);
                }
            }

            //get payments sent
            String payment_content = httpClientLnd.getAllPaymentsByLnd(tokenKey.getAccess_token(), lndNode.getLndNodeName());
//            logger.info(payment_content);
            if (payment_content != null) {
                ArrayList<TransactionHistory> transactionHistories2 = new TransactionHistory().mapPaymentListHistory(payment_content, lndNode, tokenKey.getAccess_token(), httpClientLnd);
                if (transactionHistories2 != null && !transactionHistories2.isEmpty()) {
                    transactionHistories.addAll(transactionHistories2);
                }
            }

            //get transactions on node - deposits and withdrawls
            String transaction_content = httpClientLnd.getAllTransactionsByNodeContent(tokenKey.getAccess_token(), lndNode.getLndNodeName());
//            logger.info(transaction_content);
            if (transaction_content != null) {
                ArrayList<TransactionHistory> transactionHistories3 = new TransactionHistory().mapTransactionListHistory(transaction_content, lndNode);
                if (transactionHistories3 != null && !transactionHistories3.isEmpty()) {
                    transactionHistories.addAll(transactionHistories3);
                }
            }
        }

//        logger.info(transactionHistories.toString());
        if (transactionHistories != null && !transactionHistories.isEmpty()){
            Collections.sort(transactionHistories, TransactionHistory::compareTo);
            modelAndView.addObject("transactionHistories", transactionHistories);
        }
        modelAndView.setViewName("transaction_history/fragments/transaction-list-container");
        return modelAndView;
    }

    @RequestMapping(value = "/get-history-fragment", method = RequestMethod.POST)
    public ModelAndView getTransactionHistoryFragment(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                                      @RequestParam("transactionHistory") String transaction_history) throws IOException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        TransactionHistory transactionHistory = new TransactionHistory();
        transactionHistory = transactionHistory.mapTransactionHistory(transaction_history);

//        logger.info(transactionHistory.toString());

        modelAndView.addObject("transactionHistory", transactionHistory);
        modelAndView.setViewName("transaction_history/fragments/history-item-detail");
        return modelAndView;

    }


    //load invoice detail frag
    @RequestMapping(value = "/invoice-details", method = RequestMethod.POST)
    public ModelAndView getInvoiceDetails(@RequestParam("invoice") String content,
                                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        Invoice invoice = new Invoice().mapContent(content);

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setCurrency(userService.getSessionCurrency(session));

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));
        LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));

        if (lndNodeInfo != null) {
            lndNode.setLndNodeInfo(lndNodeInfo);
        }

        modelAndView.addObject("invoice", invoice);
        modelAndView.addObject("lndNode", lndNode);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("transaction_history/fragments/invoice-detail-modal");
        return modelAndView;

    }

    //load transaction detail frag
    @RequestMapping(value = "/transaction-details", method = RequestMethod.POST)
    public ModelAndView getTransactionDetails(@RequestParam("transaction") String content,
                                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        Transaction transaction = new Transaction().mapContent(content);

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setCurrency(userService.getSessionCurrency(session));

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));
        LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));

        if (lndNodeInfo != null) {
            lndNode.setLndNodeInfo(lndNodeInfo);
        }

        modelAndView.addObject("transaction", transaction);
        modelAndView.addObject("lndNode", lndNode);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("transaction_history/fragments/transaction-detail-modal");
        return modelAndView;

    }

    //load payment detail frag
    @RequestMapping(value = "/payment-details", method = RequestMethod.POST)
    public ModelAndView getPaymentDetails(@RequestParam("payment") String content,
                                          HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        Payment payment = new Payment().mapContent(content);

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }
        user.setCurrency(userService.getSessionCurrency(session));

        LndNode lndNode = httpClientLnd.getLndNode(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));
        LndNodeInfo lndNodeInfo = httpClientLnd.getLndNodeInfo(tokenKey.getAccess_token(), (String) session.getAttribute("lnd"));

        if (lndNodeInfo != null) {
            lndNode.setLndNodeInfo(lndNodeInfo);
        }

        modelAndView.addObject("payment", payment);
        modelAndView.addObject("lndNode", lndNode);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("transaction_history/fragments/payment-detail-modal");
        return modelAndView;

    }

    //load transactions for datatable


    //load invoices for datatable
    @RequestMapping(value = "/load-invoice-data", method = RequestMethod.GET)
    public Object getInvoiceData(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        //if lnd session not set redirect to profile
        String lnd_name = (String) session.getAttribute("lnd");
        if (lnd_name == null){
            return new ModelAndView("redirect:/profile");
        }

        //get invoices
        String invoice_content = httpClientLnd.getAllInvoicesPaginated(tokenKey.getAccess_token(), lnd_name, null, null, null);

        JSONObject invoiceData = new JSONObject();
        //get page number page size and total for payments
        if (invoice_content != null && httpClientLnd.isJson(invoice_content)) {
            JSONObject jsonObject = new JSONObject(invoice_content);
            if (jsonObject.has("data") && jsonObject.get("data") != null) {
                ArrayList<Invoice> invoices = new Invoice().mapInvoiceListDB(invoice_content);
                invoiceData = new JSONObject(new Invoice().listToJson(invoices));
                JSONObject jsonObject1 = jsonObject.getJSONObject("data");
                invoiceData.put("invoicePageNumber", jsonObject1.getInt("pageNumber"))
                            .put("invoiceTotalPages", jsonObject1.getInt("totalPages"))
                            .put("invoicePageSize", jsonObject1.getInt("pageSize"))
                            .put("invoiceTotalItems", jsonObject1.getInt("total"));
                logger.info(invoiceData.toString());
            }
        }

        return invoiceData;
    }

    //sync payments
    @RequestMapping(value = "/sync-payments-data", method = RequestMethod.GET)
    public Object updatePaymentsData(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        //if lnd session not set redirect to profile
        String lnd_name = (String) session.getAttribute("lnd");
        if (lnd_name == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Failed to Get LND");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        String payment_content = httpClientLnd.getAllPaymentsPaginated(tokenKey.getAccess_token(), lnd_name, null, String.valueOf(1), true);
        //get page number page size and total for payments
        if (payment_content != null && httpClientLnd.isJson(payment_content)) {
            JSONObject jsonObject = new JSONObject(payment_content);
            if (jsonObject.has("data") && jsonObject.get("data") != null) {
                ArrayList<Payment> payments = new Payment().mapPaymentList(payment_content);
                if (payments != null){
                    JSONObject jsonObject1 = new JSONObject();
                    jsonObject1.put("status", 200).put("message", "Updated Payments Please Refresh Page");
                    return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
                }
            }else{
                JSONObject jsonObject1 = new JSONObject(payment_content);
                return new ResponseEntity<>(jsonObject1.toString(), HttpStatus.BAD_REQUEST);
            }
        }
        JSONObject jsonObject1 = new JSONObject();
        jsonObject1.put("status", 400).put("message", "Failed to Update Payments");
        return new ResponseEntity<>(jsonObject1.toString(), HttpStatus.BAD_REQUEST);
    }
}
