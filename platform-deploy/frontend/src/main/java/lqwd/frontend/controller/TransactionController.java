package lqwd.frontend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import lqwd.frontend.httpclient.HttpClientApiKey;
import lqwd.frontend.httpclient.HttpClientLnd;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.Invoice;
import lqwd.frontend.model.LndNode;
import lqwd.frontend.model.Transaction;
import lqwd.frontend.model.User;
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

@Controller
public class TransactionController {

    private static Logger logger = LoggerFactory.getLogger(TransactionController.class);

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

    @RequestMapping(value = "/transactions", method = RequestMethod.GET)
    public ModelAndView getTransactionsView(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                            @RequestParam(value = "tx_hash", required = false) String tx_hash,
                                            @RequestParam(value = "lnd_name", required = false) String lnd_name) throws IOException, URISyntaxException {
        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        user.setLndNodes(httpClientLnd.getLndNodeList(tokenKey.getAccess_token()));

        logger.info(tx_hash);
        logger.info(lnd_name);

        if (tx_hash != null){
            ArrayList<Transaction> transactions = new ArrayList<>();
            if(lnd_name != null){
                transactions = httpClientLnd.getAllTransactionsByNode(tokenKey.getAccess_token(), lnd_name, userService.getSessionCurrency(session), userService.getBTCPrice());
            }else{
                for (LndNode lndNode: user.getLndNodes()){
                    ArrayList<Transaction> transactions_tmp = new ArrayList<>();
                    transactions_tmp  = httpClientLnd.getAllTransactionsByNode(tokenKey.getAccess_token(), lndNode.getLndNodeName(), userService.getSessionCurrency(session), userService.getBTCPrice());
                    if(transactions_tmp != null) {
                        transactions.addAll(transactions_tmp);
                    }
                }
            }

            for (Transaction transaction: transactions) {
                if (transaction.getTx_hash().equals(tx_hash)) {
                    modelAndView.addObject("transaction", transaction);
                }
            }
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("transactions/transaction-details");
        return modelAndView;
    }

    @RequestMapping(value = "/get-transaction-details", method = RequestMethod.GET)
    public ModelAndView getTransactionDetails(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                              @RequestParam(value = "lnd_name") String lnd_name, @RequestParam(value = "tx_hash") String tx_hash) throws IOException, URISyntaxException {

        ModelAndView modelAndView = new ModelAndView();

        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            return new ModelAndView("redirect:/login");
        }

        ArrayList<Transaction> transactions = new ArrayList<>();
        transactions = httpClientLnd.getAllTransactionsByNode(tokenKey.getAccess_token(), lnd_name, userService.getSessionCurrency(session), userService.getBTCPrice());
        String currency = userService.getSessionCurrency(session);

        for (Transaction transaction : transactions){
            if(transaction.getTx_hash().equals(tx_hash)){
                modelAndView.addObject("transaction", transaction);
            }
        }

        modelAndView.addObject("user", user);
        modelAndView.setViewName("transactions/fragments/transaction-details-content");

        return modelAndView;
    }

    @RequestMapping(value = "/get-transactions", method = RequestMethod.GET)
    public Object getTransactions(HttpSession session, HttpServletRequest request, HttpServletResponse response,
                                  @RequestParam("lnd_name") String lnd_name) throws IOException, URISyntaxException {
        tokenKey = userService.getSessionInfo(request, session);

        User user = httpClientToken.checkUser(tokenKey);
        if(user == null){
            userService.removeSessionInfo(response, session);
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("error",true).put("message","Failed to Authenticate");
            return new ResponseEntity<>(jsonObject.toString(), HttpStatus.BAD_REQUEST);
        }

        ArrayList<Transaction> transactions = new ArrayList<>();
        transactions = httpClientLnd.getAllTransactionsByNode(tokenKey.getAccess_token(), lnd_name, userService.getSessionCurrency(session), userService.getBTCPrice());

        ObjectMapper objectMapper = new ObjectMapper();
        return new ResponseEntity<>(objectMapper.writeValueAsString(transactions), HttpStatus.OK);

    }
}
