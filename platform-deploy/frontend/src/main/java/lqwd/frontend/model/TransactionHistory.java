package lqwd.frontend.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.Setter;
import lqwd.frontend.controller.TransactionHistoryController;
import lqwd.frontend.httpclient.HttpClientLnd;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;

@Getter
@Setter
public class TransactionHistory implements Comparable<TransactionHistory>{

    private static Logger logger = LoggerFactory.getLogger(TransactionHistory.class);

    private String type;

    private LndNode lndNode;

    private Invoice invoice;

    private Payment payment;

    private Transaction transaction;

    private String creation_date;

    private String readableDate;


    public void setCreation_date(String creation_date) {
        this.creation_date = creation_date;
        setReadableDate(creation_date);
    }

    public void setReadableDate(String creation_date) {
        SimpleDateFormat format = new SimpleDateFormat("E dd MMM yyyy HH:mm z");
        this.readableDate = format.format(new Date(Long.parseLong(creation_date)*1000L));
    }

    public ArrayList<TransactionHistory> mapPaymentListHistory(String payment_content, LndNode lndNode, String token, HttpClientLnd httpClientLnd){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        try {
            ArrayList<TransactionHistory> transactionHistories = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(payment_content);
            if (jsonObject.has("payments")) {
                JSONArray jsonArray = jsonObject.getJSONArray("payments");

                for (int i = 0; i < jsonArray.length(); i++) {
                    Payment payment = mapper.readValue(jsonArray.getJSONObject(i).toString(), Payment.class);
                    if (payment != null) {
                        if (jsonArray.getJSONObject(i).has("htlcs")) {
                            JSONArray jsonArray1 = jsonArray.getJSONObject(i).getJSONArray("htlcs");
                            for (int j = 0; j < jsonArray1.length(); j++) {
                                PaymentHtlcs paymentHtlcs = payment.mapPaymentHtlcs(jsonArray1.getJSONObject(j).toString());

                                //set payment hops
                                if (jsonArray1.getJSONObject(j).has("route")) {

                                    paymentHtlcs.setTotal_amt_msat(jsonArray1.getJSONObject(j).getJSONObject("route").getInt("total_fees_msat"));
                                    paymentHtlcs.setTotal_amt_msat(jsonArray1.getJSONObject(j).getJSONObject("route").getInt("total_amt_msat"));

                                    if (jsonArray1.getJSONObject(j).getJSONObject("route").has("hops")) {
                                        JSONArray jsonArray2 = jsonArray1.getJSONObject(j).getJSONObject("route").getJSONArray("hops");
                                        ArrayList<PaymentHops> paymentHops_tmp = new ArrayList<>();
                                        for (int k = 0; k < jsonArray2.length(); k++) {
                                            PaymentHops paymentHops = payment.mapPaymentHops(jsonArray2.getJSONObject(k).toString());

                                            JSONObject alias_json = new JSONObject(httpClientLnd.getNodeInfo(token, lndNode.getLndNodeName(), lndNode.getNodepubkey()));
                                            String alias_lnd_name = null;

                                            if (alias_json.has("node") && alias_json.get("node") != null){
                                                if (alias_json.getJSONObject("node").has("alias") && alias_json.getJSONObject("node").get("alias") != null) {
                                                    alias_lnd_name = alias_json.getJSONObject("node").getString("alias");
                                                    paymentHops.setAlias(alias_lnd_name);
                                                }
                                            }
                                            paymentHops_tmp.add(paymentHops);
                                        }
                                        if (paymentHops_tmp != null && !paymentHops_tmp.isEmpty()) {
                                            paymentHtlcs.setPaymentHops(paymentHops_tmp);
                                        }
                                    }

                                    payment.setPaymentHtlcs(paymentHtlcs);
                                }
                            }
                        }
                        payment.setLndNode(lndNode);

                        TransactionHistory transactionHistory = new TransactionHistory();
                        transactionHistory.setType("PAYMENT");
                        transactionHistory.setPayment(payment);
                        transactionHistory.setLndNode(lndNode);
                        transactionHistory.setCreation_date(payment.getCreation_date());

                        transactionHistories.add(transactionHistory);
                    }
                }

                return transactionHistories;
            } else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
            return null;
        }
    }

    public ArrayList<TransactionHistory> mapInvoiceListHistory(String invoice_content, LndNode lndNode) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        try {

            ArrayList<TransactionHistory> transactionHistories = new ArrayList<>();
            JSONObject jsonObject = new JSONObject(invoice_content);

            if(jsonObject.has("invoices")) {
                JSONArray jsonArray = jsonObject.getJSONArray("invoices");

                for (int i = 0; i < jsonArray.length(); i++) {

                    Invoice invoice = mapper.readValue(jsonArray.getJSONObject(i).toString(), Invoice.class);
                    if (invoice != null){
                        invoice.setLndNode(lndNode);

                        TransactionHistory transactionHistory = new TransactionHistory();

                        transactionHistory.setType("INVOICE");
                        transactionHistory.setInvoice(invoice);
                        transactionHistory.setLndNode(lndNode);
                        transactionHistory.setCreation_date(invoice.getCreation_date());

                        transactionHistories.add(transactionHistory);
                    }
                }

                return  transactionHistories;
            }else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
            return null;
        }
    }

    public ArrayList<TransactionHistory> mapTransactionListHistory(String transaction_content, LndNode lndNode){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            ArrayList<TransactionHistory> transactionHistories = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(transaction_content);

            if(jsonObject.has("transactions")) {
                JSONArray jsonArray = jsonObject.getJSONArray("transactions");

                for (int i = 0; i < jsonArray.length(); i++) {

                    Transaction transaction = mapper.readValue(jsonArray.getJSONObject(i).toString(), Transaction.class);

                    if (transaction != null) {
                        transaction.setLndNode(lndNode);

                        TransactionHistory transactionHistory = new TransactionHistory();
                        transactionHistory.setType("TRANSACTION");
                        transactionHistory.setTransaction(transaction);
                        transactionHistory.setLndNode(lndNode);
                        transactionHistory.setCreation_date(transaction.getTime_stamp());

                        transactionHistories.add(transactionHistory);
                    }
                }

                return  transactionHistories;
            }else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
        }
        return null;
    }

    public TransactionHistory mapTransactionHistory(String transaction_history_content) throws JsonProcessingException {

            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        TransactionHistory transactionHistory = new TransactionHistory();

        JSONObject jsonObject = new JSONObject(transaction_history_content);

        if (jsonObject.has("lndNode")){
            LndNode lndNode_tmp;
            lndNode_tmp = mapper.readValue(jsonObject.get("lndNode").toString(), LndNode.class);
            logger.info(lndNode_tmp.toString());
            transactionHistory.setLndNode(lndNode_tmp);
        }
        if(jsonObject.has("type")) {

            String type = jsonObject.getString("type");

            if (type.equals("INVOICE")) {
                if (jsonObject.has("invoice")) {
//                        transactionHistory.setLndNode(new LndNode().mapContent(jsonObject.getJSONObject("lndNode").toString()));
                    transactionHistory.setType("INVOICE");
                    transactionHistory.setInvoice(new Invoice().mapContent(jsonObject.getJSONObject("invoice").toString()));
                }

            } else if (type.equals("PAYMENT")) {
                if (jsonObject.has("payment")) {
//                        transactionHistory.setLndNode(new LndNode().mapContent(jsonObject.getJSONObject("lndNode").toString()));
                    transactionHistory.setType("PAYMENT");
//                        logger.info(jsonObject.getJSONObject("payment").toString());
                    transactionHistory.setPayment(new Payment().mapContent(jsonObject.getJSONObject("payment").toString()));
                }

            } else if (type.equals("TRANSACTION")) {
                if (jsonObject.has("transaction")) {
//                        transactionHistory.setLndNode(new LndNode().mapContent(jsonObject.getJSONObject("lndNode").toString()));
                    transactionHistory.setType("TRANSACTION");
                    transactionHistory.setTransaction(new Transaction().mapContent(jsonObject.getJSONObject("transaction").toString()));
                }
            }
        }else{
            return null;
        }
        return  transactionHistory;
    }

    @Override
    public int compareTo(TransactionHistory transactionHistory){
        return  transactionHistory.getCreation_date().compareTo(this.getCreation_date());
    }

    @Override
    public String toString(){
        return "\nTransaction History:\n"
                + "Type: " + this.getType() + "\n"
                + "Creation Date: " + this.getCreation_date() + "\n"
                + "Readable Date: " + this.getReadableDate() + "\n"
                + "Invoice: " + this.getInvoice() + "\n"
                + "Payment: " + this.getPayment() + "\n"
                + "Transaction: " + this.getTransaction();
    }
}
