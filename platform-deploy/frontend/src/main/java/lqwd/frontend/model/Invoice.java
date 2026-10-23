package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnore;
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

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;

@Getter
@Setter
public class Invoice implements Comparable<Invoice>{

    private String memo;

    @JsonAlias({"preImage", "rPreimage", "r_preimage"})
    private String r_preimage;

    @JsonAlias({"rHash", "rhash", "r_hash"})
    private String r_hash;

    private String value;

    @JsonAlias({"value_msat", "valueMsat"})
    private String value_msat;

    private boolean settled;

    @JsonAlias({"creation_date", "creationDate"})
    private String creation_date;

    @JsonAlias({"settle_date", "settleDate"})
    private String settle_date;

    @JsonAlias({"payment_request", "paymentRequest"})
    private String payment_request;

    @JsonAlias({"description_hash", "descriptionHash"})
    private String description_hash;

    private String expiry;

    @JsonAlias({"fallback_addr", "fallbackAddr"})
    private String fallback_addr;

    @JsonAlias({"cltvExpiry", "cltv_expiry"})
    private String cltv_expiry;

    @JsonAlias({"addIndex", "add_index"})
    private String add_index;

    @JsonAlias({"settleIndex", "settled_index", "settledIndex"})
    private String settled_index;

    @JsonAlias({"amtPaidSat", "amt_paid_sat"})
    private String amt_paid_sat;

    @JsonAlias({"paymentAddr", "payment_addr"})
    private String payment_addr;

    private String state;

    private String readableSettledDate;

    private String readableCreationDate;

    private String nodeName;

    private LndNode lndNode;

    private static Logger logger = LoggerFactory.getLogger(Invoice.class);

    public Invoice(){}

    public String getCreation_date() {
        return creation_date;
    }

    public void setCreation_date(String creation_date) {
        this.creation_date = creation_date;
        setReadableCreationDate(creation_date);
    }

    public String getSettle_date() {
        return settle_date;
    }

    public void setSettle_date(String settle_date) {
        this.settle_date = settle_date;
        if(!this.settle_date.equals("0")){
            setReadableSettleDate(settle_date);
        }
    }

    public String getReadableSettleDate(){
        return readableSettledDate;
    }

    public void setReadableSettleDate(String settle_date) {
        try {
            SimpleDateFormat format = new SimpleDateFormat("E dd MMM yyyy HH:mm z");
            this.readableSettledDate = format.format(new Date(Long.parseLong(settle_date)*1000L));
        }catch (NumberFormatException e){
            this.readableSettledDate = settle_date;
        }
    }

    public String getReadableCreationDate(){
        return readableCreationDate;
    }

    public void setReadableCreationDate(String creation_date) {
        try {
            SimpleDateFormat format = new SimpleDateFormat("E dd MMM yyyy HH:mm z");
            this.readableCreationDate = format.format(new Date(Long.parseLong(creation_date)*1000L));
        }catch (NumberFormatException e){
            this.readableCreationDate = creation_date;
        }
    }

    public String getPayment_request() {
        return payment_request;
    }

    public Invoice mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        Invoice invoice = new Invoice();
        try {

            invoice = mapper.readValue(content, Invoice.class);

        } catch (IOException e) {
            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return invoice;
    }

    public ArrayList<Invoice> mapInvoiceList(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            ArrayList<Invoice> invoices = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(content);
            if(jsonObject.has("invoices")) {
                JSONArray jsonArray = jsonObject.getJSONArray("invoices");

                for (int i = 0; i < jsonArray.length(); i++) {

//                    logger.info(jsonArray.getJSONObject(i).toString());
                    Invoice invoice = new Invoice();
                    invoice = mapper.readValue(jsonArray.getJSONObject(i).toString(), Invoice.class);
//                    logger.info(invoice.toString());
                    invoices.add(invoice);
                }

                return  invoices;
            }else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
            return null;
        }
    }

    public ArrayList<Invoice> mapInvoiceList(String content, LndNode lndNode, String currency) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            ArrayList<Invoice> invoices = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(content);
            if(jsonObject.has("invoices")) {
                JSONArray jsonArray = jsonObject.getJSONArray("invoices");

                for (int i = 0; i < jsonArray.length(); i++) {

//                    logger.info(jsonArray.getJSONObject(i).toString());
                    Invoice invoice = new Invoice();
                    invoice = mapper.readValue(jsonArray.getJSONObject(i).toString(), Invoice.class);
                    invoice.setLndNode(lndNode);
//                    logger.info(invoice.toString());
                    invoices.add(invoice);
                }

                return  invoices;
            }else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
            return null;
        }
    }

    public ArrayList<Invoice> mapInvoiceListDB(String content){
        ObjectMapper mapper = new ObjectMapper()
                .setPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CAMEL_CASE)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        try {

            ArrayList<Invoice> invoices = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(content);

            if(jsonObject.has("data") && jsonObject.get("data") != null) {
                //get json object data from transaction call
                JSONObject jsonObject1 = jsonObject.getJSONObject("data");

                if (jsonObject1.has("data")) {
                    //get json array data from object if exists
                    JSONArray jsonArray = jsonObject1.getJSONArray("data");
                    for (int i = 0; i < jsonArray.length(); i++) {
                        //loop and map values of jsonArray
                        Invoice invoice = new Invoice();
                        invoice = mapper.readValue(jsonArray.getJSONObject(i).toString(), Invoice.class);
                        invoices.add(invoice);
                    }

                    return invoices;
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

    public String listToJson(ArrayList<Invoice> invoices) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategy.SNAKE_CASE);

        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        mapper.writeValue(out, invoices);

        return out.toString();
    }

    @Override
    public String toString(){

        return "\nInvoice:\n"
                + "PreImage: " + this.getR_preimage() + "\n"
                + "R_Hash: " + this.getR_hash() + "\n"
                + "Value: " + this.getValue() + "\n"
                + "Value MSAT: " + this.getValue_msat() + "\n"
                + "Settled: " + this.isSettled() + "\n"
                + "State: " + this.getState() + "\n"
                + "Creation Date: " + this.getCreation_date() + "\n"
                + "Settled Date: " + this.getSettle_date() + "\n"
                + "Readable Creation Date: " + this.getReadableCreationDate() + "\n"
                + "Readable Settled Date: " + this.getReadableSettleDate() + "\n"
                + "Payment Request: " + this.getPayment_request() + "\n"
                + "Description Hash: " + this.getDescription_hash() + "\n"
                + "Expiry: " + this.getExpiry() + "\n"
                + "Fallback Address: " + this.getFallback_addr() + "\n"
                + "City Expiry: " + this.getCltv_expiry() + "\n"
                + "Add Index: " + this.getAdd_index() + "\n"
                + "Settled Index: " + this.getSettled_index() + "\n"
                + "Amount Paid SAT: " + this.getAmt_paid_sat() + "\n"
                + "Payment Address: " + this.getPayment_addr();
    }

    @Override
    public int compareTo(Invoice invoice){
        return  invoice.getCreation_date().compareTo(this.getCreation_date());
//        return this.getCreation_date().compareTo(invoice.getCreation_date());
    }
}