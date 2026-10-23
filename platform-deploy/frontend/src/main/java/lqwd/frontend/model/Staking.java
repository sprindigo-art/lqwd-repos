package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.awt.*;
import java.io.IOException;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Date;

import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Staking implements Serializable {
    private static Logger logger = LoggerFactory.getLogger(Staking.class);
    private int totalDays;
    private int daysLeft;
    private String status;
    private double amount;
    private String nodeName;
    private String pubKey;
    private String ipAddress;
    private String type;
    private String address;
    private String paymentRequest;
    private String rhash;
    private String paymentDate;
    private Date dateCreated;

    public void setDateCreated(Date createdDate) {
        this.dateCreated = createdDate;
    }

    public Date getDateCreated() {
        return dateCreated;
    }

    public void setPaymentDate(String paymentDate) {
        this.paymentDate = paymentDate;
    }

    public String getPaymentDate() {
        return paymentDate;
    }

    @Override
    public String toString() {
        return "Staking{" +
                "totalDays=" + totalDays +
                ", daysLeft=" + daysLeft +
                ", status='" + status + '\'' +
                ", amount=" + amount +
                ", pubKey='" + pubKey + '\'' +
                ", ipAddress='" + ipAddress + '\'' +
                ", type='" + type + '\'' +
                ", address='" + address + '\'' +
                ", paymentRequest='" + paymentRequest + '\'' +
                ", rHash='" + rhash + '\'' +
                '}';
    }

    public Staking() {}

    public void setStatus(String status) {
        this.status = status;
    }

    public void setDaysLeft(int daysLeft) {
        this.daysLeft = daysLeft;
    }

    public static void setLogger(Logger logger) {
        Staking.logger = logger;
    }

    public String getStatus() {
        return status;
    }

    public int getDaysLeft() {
        return daysLeft;
    }

    public static Logger getLogger() {
        return logger;
    }

    public void setAddress(String address) {
        this.address = address;
    }

    public String getAddress() {
        return address;
    }


    public void setPubKey(String pubKey) {
        this.pubKey = pubKey;
    }

    public String getPubKey() {
        return pubKey;
    }

    public void setType(String type) {
        this.type = type;
    }

    public void setIpAddress(String apiAddress) {
        this.ipAddress = apiAddress;
    }
    public void setNodeName(String nodeName) {
        this.nodeName = nodeName;
    }

    public void setAmount(double amount) {
        this.amount = amount;
    }

    public void setTotalDays(int days) {
        this.totalDays = days;
    }

    public void setPaymentRequest(String payment_request) {
        this.paymentRequest = payment_request;
    }

    public void setRhash(String rhash) {
        this.rhash = rhash;
    }

    public String getType() {
        return type;
    }

    public String getIpAddress() {
        return ipAddress;
    }
    public String getNodeName() {
        return nodeName;
    }
    public double getAmount() {
        return amount;
    }

    public int getTotalDays() {
        return totalDays;
    }

    public String getPaymentRequest() {
        return paymentRequest;
    }

    public String getRhash() {
        return rhash;
    }
    

    public Staking mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        Staking staking = new Staking();
        try {

            staking = mapper.readValue(content, Staking.class);

        } catch (IOException e) {
            logger.error(e.getMessage());
        }
        return staking;
    }

    public ArrayList<Staking> mapListStaking(String content) {
        ArrayList<Staking> stakingList = new ArrayList<>();
        JSONObject jsonObject = new JSONObject(content);
        if (jsonObject.has("data")) {

            JSONArray jsonArray = jsonObject.getJSONObject("data").getJSONArray("items");

            for (int i = 0; i < jsonArray.length(); i++) {
                Staking staking = this.mapContent(jsonArray.getJSONObject(i).toString());
                logger.info(staking.toString());
                stakingList.add(staking);
            }
        }
        return stakingList;
    }
}
