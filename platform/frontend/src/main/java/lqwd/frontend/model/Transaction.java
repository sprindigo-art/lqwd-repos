package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import lombok.Getter;
import lombok.Setter;
import lqwd.frontend.service.UserService;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URISyntaxException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;

@Getter
@Setter
public class Transaction {



    private ArrayList<String> dest_addresses;
    private String readableDate;
    private LndNode lndNode;

    private Date created;
    private Date updated;

    private Long amount;

    @JsonAlias("label")
    private String label;

    @JsonAlias({"blockHash", "block_has"})
    private String block_hash;

    @JsonAlias({"blockHeight", "block_height"})
    private Integer block_height;

    @JsonAlias({"totalFees", "total_fees"})
    private Double total_fees;

    @JsonAlias({"transactionHash", "tx_hash", "txHash"})
    private String tx_hash;

    @JsonAlias({"noOfConfirmations", "num_confirmations", "numConfirmations"})
    private Integer num_confirmations;

    @JsonAlias({"rawTransactionHex", "raw_tx_hex", "rawTxHex"})
    private String raw_tx_hex;

    @JsonAlias({"nodeName", "lnd_name", "lndName"})
    private String lnd_name;

    @JsonAlias({"timeStamp", "time_stamp", "timestamp"})
    private String time_stamp;

    private static Logger logger = LoggerFactory.getLogger(Transaction.class);

    public Transaction(){}

    public void setTime_stamp(String time_stamp){
        this.time_stamp = time_stamp;
        setReadableDate(time_stamp);
    }

    public String getReadableDate(){
        return readableDate;
    }

    public void setReadableDate(String readableDate) {
        try {
            SimpleDateFormat format = new SimpleDateFormat("E dd MMM yyyy HH:mm z");
            this.readableDate = format.format(new Date(Long.parseLong(readableDate)*1000L));
        }catch (NumberFormatException e){
            this.readableDate = readableDate;
        }
    }

    public Transaction mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        Transaction transaction = new Transaction();
        try {

            transaction = mapper.readValue(content, Transaction.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return transaction;
    }

    public ArrayList<Transaction> mapTransactionList(String content, String currency, BitcoinPrice bitcoinPrice, String lnd_name) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            ArrayList<Transaction> transactions = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(content);

            if(jsonObject.has("transactions")) {
                JSONArray jsonArray = jsonObject.getJSONArray("transactions");

                for (int i = 0; i < jsonArray.length(); i++) {
                    Transaction transaction = new Transaction();
                    transaction = mapper.readValue(jsonArray.getJSONObject(i).toString(), Transaction.class);
//                    if(!currency.equals("satoshi")){
//                        Double transactionAmount = 0D;
//                        if(transaction.getAmount().contains("-")){
//                            transactionAmount = Math.abs(Float.parseFloat(transaction.getAmount()))*Math.pow(10,-8);
//                            if (currency.equals("CAD") || currency.equals("USD")){
//                                if (bitcoinPrice != null){
//                                    if (currency.equals("CAD")){
//                                        transactionAmount *= bitcoinPrice.getCad();
//                                    }else{
//                                        transactionAmount *= bitcoinPrice.getUsd();
//                                    }
//                                }
//                            }
//                            transaction.setAmount(String.valueOf(transactionAmount*-1));
//                        }else{
//                            transactionAmount = Float.parseFloat(transaction.getAmount())*Math.pow(10,-8);
//                            if (currency.equals("CAD") || currency.equals("USD")){
//                                if (bitcoinPrice != null){
//                                    if (currency.equals("CAD")){
//                                        transactionAmount *= bitcoinPrice.getCad();
//                                    }else{
//                                        transactionAmount *= bitcoinPrice.getUsd();
//                                    }
//                                }
//                            }
//                            transaction.setAmount(String.valueOf(transactionAmount));
//                        }
//                    }
                    transaction.setLnd_name(lnd_name);
                    transactions.add(transaction);
                }

                return  transactions;
            }else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
        }
        return null;
    }

    public ArrayList<Transaction> mapTransactionList(String content){
        ObjectMapper mapper = new ObjectMapper()
                .setPropertyNamingStrategy(PropertyNamingStrategy.LOWER_CAMEL_CASE)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            ArrayList<Transaction> transactions = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(content);

            if(jsonObject.has("data") && jsonObject.get("data") != null) {
                //get json object data from transaction call
                JSONObject jsonObject1 = jsonObject.getJSONObject("data");

                if (jsonObject1.has("data")) {
                    //get json array data from object if exists
                    JSONArray jsonArray = jsonObject1.getJSONArray("data");
                    for (int i = 0; i < jsonArray.length(); i++) {
                        //loop and map values of jsonArray
                        Transaction transaction = new Transaction();
                        transaction = mapper.readValue(jsonArray.getJSONObject(i).toString(), Transaction.class);
                        transactions.add(transaction);
                    }

                    return transactions;
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
    public String toString(){
        return "Transaction\n+" +
                "Tx Hash: " + this.getTx_hash() +"\n" +
                "Amount: " + this.getAmount() +"\n" +
                "Num Confirmations: " + this.getNum_confirmations() +"\n" +
                "Block Hash: " + this.getBlock_hash() +"\n" +
                "Block Height: " + this.getBlock_height() +"\n" +
                "Timestamp: " + this.getTime_stamp() +"\n" +
                "Total Fees: " + this.getTotal_fees() +"\n" +
                "Raw Tx Hex: " + this.getRaw_tx_hex() +"\n" +
                "Label: " + this.getLabel() +"\n" +
                "Created: " + this.getCreated() +"\n" +
                "Updated: " + this.getUpdated() +"\n" +
                "Readable Date: " + this.getReadableDate();
    }
}
