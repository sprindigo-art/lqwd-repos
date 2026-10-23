package lqwd.frontend.model;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
public class LiquidityInvoice {
    private static Logger logger = LoggerFactory.getLogger(LiquidityInvoice.class);
    private Long paymentOptionId;
    private int amt;
    private int requestedAmt;
    private int fee;
    private int feeToPay;
    private int durationInWeeks;
    private String type;
    private Date dateCreated;
    private Boolean paid = false;
    private String paymentRequest;
    private String pubkey;
    private String ipAddress;
    private Date channelExpiryDate;

    public void setPaymentRequest(String paymentRequest) {
        this.paymentRequest = paymentRequest;
    }

    public String getPaymentRequest() {
        return paymentRequest;
    }

    public void setIpAddress(String ipAddress) {
        this.ipAddress = ipAddress;
    }

    public void setPubkey(String pubkey) {
        this.pubkey = pubkey;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public String getPubkey() {
        return pubkey;
    }

    public LiquidityInvoice() {
    }

    public void setDateCreated(Date dateCreated) {
        this.dateCreated = dateCreated;
    }

    public void setFee(int fee) {
        this.fee = fee;
    }

    public void setChannelExpiryDate(Date channelExpiryDate) {
        this.channelExpiryDate = channelExpiryDate;
    }

    public void setPaid(Boolean paid) {
        this.paid = paid;
    }

    public void setType(String type) {
        this.type = type;
    }

    public void setDurationInWeeks(int durationInWeeks) {
        this.durationInWeeks = durationInWeeks;
    }

    public void setFeeToPay(int feeToPay) {
        this.feeToPay = feeToPay;
    }

    public void setRequestedAmt(int requestedAmt) {
        this.requestedAmt = requestedAmt;
    }

    public void setAmt(int amt) {
        this.amt = amt;
    }

    public void setPaymentOptionId(Long paymentOptionId) {
        this.paymentOptionId = paymentOptionId;
    }

    public Date getChannelExpiryDate() {
        return channelExpiryDate;
    }

    public Boolean getPaid() {
        return paid;
    }

    public String getType() {
        return type;
    }

    public int getDurationInWeeks() {
        return durationInWeeks;
    }

    public int getFeeToPay() {
        return feeToPay;
    }

    public int getRequestedAmt() {
        return requestedAmt;
    }

    public int getAmt() {
        return amt;
    }

    public Long getPaymentOptionId() {
        return paymentOptionId;
    }

    public Date getDateCreated() {
        return dateCreated;
    }

    public int getFee() {
        return fee;
    }

    public LiquidityInvoice mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LiquidityInvoice liquidityInvoice = new LiquidityInvoice();
        try {

            liquidityInvoice = mapper.readValue(content, LiquidityInvoice.class);

        } catch (IOException e) {
            logger.error(e.getMessage());
        }
        return liquidityInvoice;
    }
    public ArrayList<LiquidityInvoice> mapListLiquidityInvoice(String content) {
        ArrayList<LiquidityInvoice> liquidityInvoices = new ArrayList<>();
        JSONObject jsonObject = new JSONObject(content);
        if (jsonObject.has("data")) {
            JSONArray jsonArray = jsonObject.getJSONObject("data").getJSONArray("data");

            for (int i = 0; i < jsonArray.length(); i++) {
                LiquidityInvoice liquidityInvoice = this.mapContent(jsonArray.getJSONObject(i).toString());
                logger.info(liquidityInvoice.toString());
                liquidityInvoices.add(liquidityInvoice);
            }
        }
        return liquidityInvoices;
    }
    @Override
    public String toString() {
        return "LiquidityInvoice{" +
                "paymentOptionId=" + paymentOptionId +
                ", amt=" + amt +
                ", requestedAmt=" + requestedAmt +
                ", fee=" + fee +
                ", feeToPay=" + feeToPay +
                ", durationInWeeks=" + durationInWeeks +
                ", type='" + type + '\'' +
                ", dateCreated=" + dateCreated +
                ", paid=" + paid +
                ", pubkey='" + pubkey + '\'' +
                ", ipAddress='" + ipAddress + '\'' +
                ", channelExpiryDate=" + channelExpiryDate +
                '}';
    }
}
