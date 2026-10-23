package lqwd.frontend.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.persistence.Column;
import javax.persistence.Temporal;
import javax.persistence.TemporalType;
import java.util.ArrayList;
import java.util.Date;

public class LiquidityBtcType {
    private static Logger logger = LoggerFactory.getLogger(LndAddress.class);
    private Long id;
    private double amount;
    private Date created;
    private String walletAddress;

    public void setWalletAddress(String walletAddress) {
        this.walletAddress = walletAddress;
    }

    public void setCreated(Date created) {
        this.created = created;
    }

    public void setAmount(double amount) {
        this.amount = amount;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getWalletAddress() {
        return walletAddress;
    }

    public Date getCreated() {
        return created;
    }

    public double getAmount() {
        return amount;
    }
    public Long getId() {
        return id;
    }
    @Override
    public String toString() {
        return "LiquidityBtcType{" +
                "id=" + id +
                ", amount=" + amount +
                ", created=" + created +
                ", walletAddress='" + walletAddress + '\'' +
                '}';
    }
    public ArrayList<LiquidityBtcType> mapBtcLiquidityList(String content)  {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        try {

            ArrayList<LiquidityBtcType> addresses = new ArrayList<>();

            JSONObject jsonObject = new JSONObject(content);
            if(jsonObject.has("data")) {
                JSONArray jsonArray = jsonObject.getJSONArray("data");
                for (int i = 0; i < jsonArray.length(); i++) {
                    LiquidityBtcType address = mapper.readValue(jsonArray.getJSONObject(i).toString(), LiquidityBtcType.class);
//                    logger.info(address.toString());
                    addresses.add(address);
                }

                return  addresses;
            }else {
                return null;
            }
        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
            return null;
        }
    }

}
