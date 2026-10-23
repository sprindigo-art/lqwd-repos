package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import lombok.Getter;
import lombok.Setter;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.sql.Timestamp;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;

@Getter
@Setter
public class Payment implements Comparable<Payment>{


    private String destination;

    private Integer timestamp;

    private Integer expiry;

    private String description;

    private String status;

    private String readableCreationDate;

    private Integer value;

    private Integer fee;

    @JsonAlias({"paymentIndex", "payment_index"})
    private String payment_index;

    @JsonAlias({"payment_hash", "paymentHash"})
    private String payment_hash;

    @JsonAlias({"num_satoshis", "numSatoshis"})
    private Integer num_satoshis;

    @JsonAlias({"payment_preimage", "paymentPreimage"})
    private String payment_preimage;

    @JsonAlias({"description_hash", "descriptionHash"})
    private String description_hash;

    @JsonAlias({"fallback_addr", "fallbackAddr"})
    private String fallback_addr;

    @JsonAlias({"cltv_expiry", "cltvExpiry"})
    private Integer cltv_expiry;

    @JsonAlias({"payment_addr", "paymentAddr"})
    private String payment_addr;

    @JsonAlias({"num_msat", "numMsat"})
    private Integer num_msat;

    @JsonAlias({"creation_date", "creationDate"})
    private String creation_date;

    @JsonAlias({"payment_request", "paymentRequest"})
    private String payment_request;

    @JsonAlias({"value_sat", "valueSat"})
    private Integer value_sat;

    @JsonAlias({"value_msat", "valueMsat"})
    private Integer value_msat;

    @JsonAlias({"fee_sat", "feeSat"})
    private Integer fee_sat;

    @JsonAlias({"fee_msat", "feeMsat"})
    private Integer fee_msat;

    @JsonAlias({"creation_time_ns", "creationTimeNs"})
    private Long creation_time_ns;

    @JsonAlias({"failure_reason", "failureReason"})
    private String failure_reason;

    private LndNode lndNode;

    private ArrayList<PaymentHtlcs> htlcs;

    private PaymentHtlcs paymentHtlcs;

    private static Logger logger = LoggerFactory.getLogger(Payment.class);

    public Payment(){}

    public String getReadableCreationDate(){
        return readableCreationDate;
    }

    public void setReadableCreationDate(long creation_date) {
        try {
            SimpleDateFormat format = new SimpleDateFormat("E dd MMM yyyy HH:mm z");
            this.readableCreationDate = format.format(creation_date*1000L);
        }catch (NumberFormatException e){
            this.readableCreationDate = String.valueOf(creation_date);
        }
    }

    public void setCreation_time_ns(Long creation_time_ns) throws ParseException {
        this.creation_time_ns = creation_time_ns;
        long create_time = creation_time_ns/(long) Math.pow(10,9);

        setCreation_date(String.valueOf(create_time));
        setReadableCreationDate(create_time);

    }

    public void setCreation_date(String creation_date) throws ParseException {
        this.creation_date = creation_date;
    }

    public LndNode getLndNode() {
        return lndNode;
    }

    public void setLndNode(LndNode lndNode) {
        this.lndNode = lndNode;
    }

    public Payment mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        Payment payment = new Payment();
        try {

            payment = mapper.readValue(content, Payment.class);
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("payment_htlcs")) {
                PaymentHtlcs paymentHtlcs = mapper.readValue(jsonObject.getJSONObject("payment_htlcs").toString(), PaymentHtlcs.class);
                payment.setPaymentHtlcs(paymentHtlcs);
                if (jsonObject.getJSONObject("payment_htlcs").has("payment_hops")){
                    JSONArray jsonArray2 = jsonObject.getJSONObject("payment_htlcs").getJSONArray("payment_hops");
                    ArrayList<PaymentHops> paymentHops_tmp = new ArrayList<>();
                    for (int k = 0; k < jsonArray2.length(); k++) {
                        PaymentHops paymentHops = mapPaymentHops(jsonArray2.getJSONObject(k).toString());
                        paymentHops_tmp.add(paymentHops);

                        if (paymentHops_tmp != null && !paymentHops_tmp.isEmpty()) {
                            paymentHtlcs.setPaymentHops(paymentHops_tmp);
                        }
                    }
                }else{
                    paymentHtlcs.setPaymentHops(null);
                }
                payment.setPaymentHtlcs(paymentHtlcs);
            }else{
                payment.setPaymentHtlcs(null);
            }
        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return payment;
    }

    public PaymentHtlcs mapPaymentHtlcs(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        PaymentHtlcs paymentHtlcs = new PaymentHtlcs();
        try {

            paymentHtlcs = mapper.readValue(content, PaymentHtlcs.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return paymentHtlcs;
    }

    public PaymentHops mapPaymentHops(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        PaymentHops paymentHops = new PaymentHops();

        try {

            paymentHops = mapper.readValue(content, PaymentHops.class);
        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return paymentHops;
    }

//    public Payment mapFeeEstimate(String content){
//        ObjectMapper mapper = new ObjectMapper()
//                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
//        try {
//            Payment payment = new Payment();
//
//            payment = mapper.readValue(content, Payment.class);
//
//            return payment;
//
//        } catch (IOException e) {
////            e.printStackTrace();
//            logger.error(e.getMessage());
//        }
//
//    }

    public ArrayList<Payment> mapPaymentList(String content, LndNode lndNode) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            ArrayList<Payment> payments = new ArrayList<>();
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("payments")) {
                JSONArray jsonArray = jsonObject.getJSONArray("payments");

                for (int i = 0; i < jsonArray.length(); i++) {
                    Payment payment = mapper.readValue(jsonArray.getJSONObject(i).toString(), Payment.class);
                    if (payment != null) {
                        //set payment htlcs
                        if (jsonArray.getJSONObject(i).has("htlcs")) {
                                JSONArray jsonArray1 = jsonArray.getJSONObject(i).getJSONArray("htlcs");
                                for (int j = 0; j < jsonArray1.length(); j++) {
                                    PaymentHtlcs paymentHtlcs = mapPaymentHtlcs(jsonArray1.getJSONObject(j).toString());

                                    //set payment hops
                                    if (jsonArray1.getJSONObject(j).has("route")) {

                                        paymentHtlcs.setTotal_amt_msat(jsonArray1.getJSONObject(j).getJSONObject("route").getInt("total_fees_msat"));
                                        paymentHtlcs.setTotal_amt_msat(jsonArray1.getJSONObject(j).getJSONObject("route").getInt("total_amt_msat"));

                                        if (jsonArray1.getJSONObject(j).getJSONObject("route").has("hops")) {
                                            JSONArray jsonArray2 = jsonArray1.getJSONObject(j).getJSONObject("route").getJSONArray("hops");
                                            ArrayList<PaymentHops> paymentHops_tmp = new ArrayList<>();
                                            for (int k = 0; k < jsonArray2.length(); k++) {
                                                PaymentHops paymentHops = mapPaymentHops(jsonArray2.getJSONObject(k).toString());
                                                paymentHops_tmp.add(paymentHops);
                                            }
                                            if (paymentHops_tmp != null && !paymentHops_tmp.isEmpty()) {
                                                paymentHtlcs.setPaymentHops(paymentHops_tmp);
                                            }
                                        }

                                        this.setPaymentHtlcs(paymentHtlcs);
                                }
                            }
                        }
                        payment.setLndNode(lndNode);
                        payments.add(payment);
                    }
                }

                return payments;
            } else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
            return null;
        }
    }

    //mapping for payment list from db
    public ArrayList<Payment> mapPaymentList(String content){
        ObjectMapper mapper = new ObjectMapper()
                .setPropertyNamingStrategy(PropertyNamingStrategy.SNAKE_CASE)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            ArrayList<Payment> payments = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(content);

            if(jsonObject.has("data") && jsonObject.get("data") != null) {
                //get json object data from transaction call
                JSONObject jsonObject1 = jsonObject.getJSONObject("data");

                if (jsonObject1.has("data") && jsonObject1.get("data") != null) {
                    //get json array data from object if exists
                    JSONArray jsonArray = jsonObject1.getJSONArray("data");
                    for (int i = 0; i < jsonArray.length(); i++) {
                        //loop and map values of jsonArray
                        Payment payment = new Payment();
                        payment = mapper.readValue(jsonArray.getJSONObject(i).toString(), Payment.class);

                        if (jsonArray.getJSONObject(i).has("htlcs")) {
                            JSONArray jsonArray1 = jsonArray.getJSONObject(i).getJSONArray("htlcs");
                            for (int j = 0; j < jsonArray1.length(); j++) {
                                PaymentHtlcs paymentHtlcs = mapPaymentHtlcs(jsonArray1.getJSONObject(j).toString());

                                //set payment hops
                                if (jsonArray1.getJSONObject(j).has("route")) {

                                    paymentHtlcs.setTotal_amt_msat(jsonArray1.getJSONObject(j).getJSONObject("route").getInt("total_fees_msat"));
                                    paymentHtlcs.setTotal_amt_msat(jsonArray1.getJSONObject(j).getJSONObject("route").getInt("total_amt_msat"));

                                    if (jsonArray1.getJSONObject(j).getJSONObject("route").has("hops")) {
                                        JSONArray jsonArray2 = jsonArray1.getJSONObject(j).getJSONObject("route").getJSONArray("hops");
                                        ArrayList<PaymentHops> paymentHops_tmp = new ArrayList<>();
                                        for (int k = 0; k < jsonArray2.length(); k++) {
                                            PaymentHops paymentHops = mapPaymentHops(jsonArray2.getJSONObject(k).toString());
                                            paymentHops_tmp.add(paymentHops);
                                        }
                                        if (!paymentHops_tmp.isEmpty()) {
                                            paymentHtlcs.setPaymentHops(paymentHops_tmp);
                                        }
                                    }

                                    payment.setPaymentHtlcs(paymentHtlcs);
                                }
                            }
                        }
                        payments.add(payment);
                    }

                    return payments;
                } else {
                    return null;
                }
            }else{
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
        }
        return null;
    }

    public String toJson() throws JsonProcessingException {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategy.SNAKE_CASE);
        return mapper.writeValueAsString(this);
    }

    @Override
    public int compareTo(Payment payment){
        return  payment.getCreation_date().compareTo(this.getCreation_date());
    }

    @Override
    public String toString(){
        return "\nPayment Details:\n"
                + "Destination: " + this.getDestination() + "\n"
                + "Payment Hash: " + this.getPayment_hash() + "\n"
                + "Num Satoshis: " + this.getNum_satoshis() + "\n"
                + "Timestamp: " + this.getTimestamp() + "\n"
                + "Expiry: " + this.getExpiry() + "\n"
                + "Description: " + this.getDescription() + "\n"
                + "Description hash: " + this.getDescription_hash() + "\n"
                + "Fallback Addr: " + this.getFallback_addr() + "\n"
                + "City Expiry: " + this.getCltv_expiry() + "\n"
                + "Payment Addr: " + this.getPayment_addr() + "\n"
                + "Payment Request: " + this.getPayment_request() + "\n"
                + "Status: " + this.getStatus() + "\n"
                + "Fee Sat: " + this.getFee_sat() + "\n"
                + "Creation Time NS: " + this.getCreation_time_ns() + "\n"
                + "Failure Reason: " + this.getFailure_reason() + "\n"
                + "Payment PreImage: " + this.getPayment_preimage() + "\n"
                + "Creation Date: " + this.getCreation_date() + "\n"
                + "Readable Creation Date: " + this.getReadableCreationDate() + "\n"
                + "Value mSAT: " + this.getValue_msat();

//                + "Payment HTLC: \n------\n" + this.getPaymentHtlcs().toString() + "\n"
//                + "Payment Hops: \n------\n" + this.getPaymentHtlcs().getPaymentHops().toString();
    }
}

