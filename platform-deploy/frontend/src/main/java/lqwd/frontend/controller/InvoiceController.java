package lqwd.frontend.controller;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.Invoice;
import lqwd.frontend.model.LndNode;
import lqwd.frontend.model.User;
import lqwd.frontend.model.WalletBalance;
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
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;

@Controller
public class InvoiceController {

    private static Logger logger = LoggerFactory.getLogger(InvoiceController.class);

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

    @RequestMapping(value = "/invoice", method = RequestMethod.GET)
    public ModelAndView createInvoicesView(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

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
        modelAndView.setViewName("invoices/create-invoice");
        return modelAndView;
    }

    @RequestMapping(value = "/invoice-link", method = RequestMethod.GET)
    public ModelAndView getInvoiceDetailsFromHash(@RequestParam(value = "invoice", required = false) String invoice_hash, @RequestParam(value = "lnd_name", required = false) String lnd_name,
                                       HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        user.setLndNodes(httpClientLnd.getLndNodeList(tokenKey.getAccess_token()));

        if(invoice_hash != null) {
            Invoice invoice = new Invoice();
            invoice = invoice.mapContent(httpClientLnd.getInvoiceDetails(tokenKey.getAccess_token(), lnd_name, invoice_hash));

            if (invoice != null) {
                modelAndView.addObject("invoice", invoice);
            }
        }
        modelAndView.addObject("lndNode", user.getLndNodes());
        modelAndView.addObject("user", user);
        modelAndView.setViewName("invoices/invoice-details");
        return modelAndView;
    }

    @RequestMapping(value = "/get-invoices", method = RequestMethod.GET)
    public Object getInvoiceList(@RequestParam("lnd_name") String lnd_name, HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if (user == null) {
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Get Invoice List");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        ArrayList<Invoice> invoices = new ArrayList<>();
        Invoice invoice = new Invoice();

        invoices = invoice.mapInvoiceList(httpClientLnd.getAllInvoices(tokenKey.getAccess_token(), lnd_name));
        if(invoices == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error", false).put("message", "No Invoices Available");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
        }
        JsonArray jsonArray = new JsonArray();
        for (Invoice invoice_tmp: invoices) {
            JsonObject jsonObject = new JsonObject();
            jsonObject.addProperty("invoice", invoice_tmp.getR_hash());
            jsonArray.add(jsonObject);
        }
        return new ResponseEntity<>(jsonArray.toString(), HttpStatus.OK);
    }

    @RequestMapping(value = "/get-invoice-details", method = RequestMethod.GET)
    public ModelAndView getInvoiceDetailsView(@RequestParam(value = "lnd_name") String lnd_name, @RequestParam(value = "invoice") String invoice_hash,
                                       HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
        }

        Invoice invoice = new Invoice();
        String content = httpClientLnd.getInvoiceDetails(tokenKey.getAccess_token(), lnd_name, invoice_hash);
        invoice = invoice.mapContent(content);

        modelAndView.addObject("invoice", invoice);
        modelAndView.setViewName("invoices/fragments/invoice-widget-content::widget-placeholder");

        return modelAndView;
    }

    // get all invoices page
    @RequestMapping(value = "/all-invoices", method = RequestMethod.GET)
    public ModelAndView getAllInvoices(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException, URISyntaxException {
        ModelAndView modelAndView = new ModelAndView();

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return null;
        }
        user.setCurrency(userService.getSessionCurrency(session));
        Invoice invoice = new Invoice();
        ArrayList<Invoice> invoices = new ArrayList<>();

        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());

        if(lndNodes != null){
            for (LndNode lndNode: lndNodes) {
                ArrayList<Invoice> invoice_tmp = new ArrayList<>();
                content = httpClientLnd.getAllInvoices(tokenKey.getAccess_token(), lndNode.getLndNodeName());


                if (content != null) {
                    invoice_tmp = invoice.mapInvoiceList(content, lndNode, user.getCurrency());
                    if(invoice_tmp != null) {
                        invoices.addAll(invoice_tmp);
                    }
                }
            }
        }

        modelAndView.addObject("invoices", invoices);
        modelAndView.addObject("user", user);
        modelAndView.setViewName("invoices/all-invoices");

        return modelAndView;
    }

    @RequestMapping(value = "/create-invoice", method = RequestMethod.POST)
    public Object createInvoice(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                @RequestParam("amount") int amount,
                                @RequestParam("password") String password,
                                @RequestParam(value = "passphrase", required = false) String passphrase) throws IOException {

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
        if(lnd_name == null) {
        	JSONObject jsonObject = new JSONObject();
            jsonObject.put("status", "400").put("message", "Please select a node");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        String content = httpClientLnd.createInvoice(tokenKey.getAccess_token(), lnd_name, amount, passphrase);
        
        if(content == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Create Invoice");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        Invoice invoice = new Invoice();
        invoice = invoice.mapContent(content);

        if(invoice.getPayment_request() == null){
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Create Invoice");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("status", "200").put("message", "Successfully Created Invoice")
                .put("pay_req",invoice.getPayment_request()).put("r_hash",invoice.getR_hash());
        return new ResponseEntity<>(jsonObject.toString(), HttpStatus.OK);
    }

    //get invoices for payment page
    @RequestMapping(value = "/get-list-ten-invoices", method = RequestMethod.GET)
    public ModelAndView getLastTenInvoicesFragment(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return null;
        }
        user.setCurrency(userService.getSessionCurrency(session));

        Invoice invoice = new Invoice();
        ArrayList<Invoice> invoices = new ArrayList<>();

        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());
        if(lndNodes !=null) {
            for (LndNode lndNode : lndNodes) {
                content = httpClientLnd.getAllInvoices(tokenKey.getAccess_token(), lndNode.getLndNodeName());
                if (content != null) {
                    ArrayList<Invoice> invoice_tmp = invoice.mapInvoiceList(content, lndNode, user.getCurrency());
                    if (invoice_tmp != null) {
                        invoices.addAll(invoice_tmp);
                    }
                }
            }

            Collections.sort(invoices, Invoice::compareTo);

        }
        if (invoices.size() > 10) {
            modelAndView.addObject("invoices", invoices.subList(invoices.size() - 10, invoices.size()));
        }else{
            modelAndView.addObject("invoices", invoices);
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("invoices/fragments/invoices::invoicesFrag");

        return modelAndView;
    }

    //get invoices for payment page
    @RequestMapping(value = "/get-invoice-frag", method = RequestMethod.GET)
    public ModelAndView getInvoicesFragment(HttpSession session, HttpServletRequest request, HttpServletResponse response) throws IOException {
        ModelAndView modelAndView = new ModelAndView();

        String content = null;
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return null;
        }
        user.setCurrency(userService.getSessionCurrency(session));

        Invoice invoice = new Invoice();
        ArrayList<Invoice> invoices = new ArrayList<>();

        ArrayList<LndNode> lndNodes = httpClientLnd.getLndNodeList(tokenKey.getAccess_token());

        if(lndNodes != null){
            for (LndNode lndNode: lndNodes) {
                ArrayList<Invoice> invoice_tmp = new ArrayList<>();
                content = httpClientLnd.getAllInvoices(tokenKey.getAccess_token(), lndNode.getLndNodeName());


                if (content != null) {
                    invoice_tmp = invoice.mapInvoiceList(content, lndNode, user.getCurrency());
                    if(invoice_tmp != null) {
                        invoices.addAll(invoice_tmp);
                    }
                }
            }
        }
        modelAndView.addObject("invoices", invoices);
        //get list of transactions and list of invoices to display
        modelAndView.addObject("user", user);
        modelAndView.setViewName("invoices/fragments/invoices::invoicesFrag");

        return modelAndView;
    }

}
