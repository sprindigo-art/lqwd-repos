package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import lombok.Getter;
import lombok.Setter;
import lqwd.frontend.controller.AccountingController;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.text.DecimalFormat;
import java.text.NumberFormat;
import java.util.*;

@Getter
@Setter
public class LndChannel {

    private boolean active;

    @JsonAlias({"remote_pubkey", "remotePubKey", "remotePubkey"})
    private String remote_pubkey;

    @JsonAlias({"remote_node_pub", "remoteNodePub"})
    private String remote_node_pub;

    @JsonAlias({"channel_point", "channelPoint"})
    private String channel_point;

    @JsonAlias({"chan_id", "channelId", "channel_id"})
    private String chan_id;

    private String capacity;

    @JsonAlias({"local_balance", "localBalance"})
    private String local_balance;

    @JsonAlias({"remote_balance", "remoteBalance"})
    private String remote_balance;

    @JsonAlias({"commit_fee", "commitFee"})
    private String commit_fee;

    @JsonAlias({"commit_weight", "commitWeight"})
    private String commit_weight;

    @JsonAlias({"fee_per_kw", "feePerKw"})
    private String fee_per_kw;

    @JsonAlias({"unsettled_balance", "unsetledBalance"})
    private String unsettled_balance;

    @JsonAlias({"total_satoshis_sent", "totalSatoshisSent"})
    private String total_satoshis_sent;

    @JsonAlias({"total_satoshis_received", "totalSatoshisReceived"})
    private String total_satoshis_received;

    @JsonAlias({"private", "isPrivate", "is_private"})
    private boolean is_private;

    @JsonAlias({"dateCreated", "date_created"})
    private Date date_created;

    @JsonAlias({"date_modified", "dateModified"})
    private Date date_modified;

    private String type;

    private boolean initiator;

    private boolean initiator_bool;

    private Double local_balance_percent;

    private Double remote_balance_percent;

    private static Logger logger = LoggerFactory.getLogger(LndChannel.class);

    public LndChannel(){

    }

    public LndChannel(String chan_id, boolean active, String local_balance, String remote_balance, String capacity){
        this.chan_id = chan_id;
        this.active = active;
        this.local_balance = local_balance;
        this.remote_balance = remote_balance;
        this.capacity = capacity;
    }

    public Integer getLocalBalanceChange(){

        return (int) Double.parseDouble(getTotal_satoshis_received()) - (int) Double.parseDouble(getTotal_satoshis_sent());
    }

    public Integer getRemoteBalanceChange(){
        return (int) Double.parseDouble(getTotal_satoshis_sent()) - (int) Double.parseDouble(getTotal_satoshis_received());
    }

    public Integer getTotalCapacity(){
        double capacity_db = Double.parseDouble(capacity);

        return (int) capacity_db;
    }

    public void setLocalBalancePercent(String local_balance, String remote_balance){
        this.local_balance_percent = (Double.parseDouble(local_balance)/(Double.parseDouble(remote_balance)+Double.parseDouble(local_balance)))*100;
        logger.info(String.valueOf(this.local_balance_percent));

    }

    public void setRemoteBalancePercent(String remote_balance, String local_balance){

        this.remote_balance_percent = (Double.parseDouble(remote_balance)/(Double.parseDouble(remote_balance)+Double.parseDouble(local_balance)))*100;
    }

    public boolean isActive() {
        return active;
    }

    public String getCompactNumber(Double value){
        DecimalFormat df = new DecimalFormat("#.#");

        NavigableMap<Double, String> suffixes = new TreeMap<>();

        suffixes.put(1_000D, "K");
        suffixes.put(1_000_000D, "M");
        suffixes.put(1_000_000_000D, "G");
        suffixes.put(1_000_000_000_000D, "T");
        suffixes.put(1_000_000_000_000_000D, "P");
        suffixes.put(1_000_000_000_000_000_000D, "E");

        //Long.MIN_VALUE == -Long.MIN_VALUE so we need an adjustment here
        if (value == Double.MIN_VALUE) return getCompactNumber(Double.MIN_VALUE + 1);
        if (value < 0) return "-" + getCompactNumber(-value);
        if (value < 1000) return Double.toString(value); //deal with easy case

        Map.Entry<Double, String> e = suffixes.floorEntry(value);
        Double divideBy = e.getKey();
        String suffix = e.getValue();

        double truncated = value / (divideBy / 10); //the number part of the output times 10

        boolean hasDecimal = truncated < 100 && (truncated / 10d) != (truncated / 10);
        return hasDecimal ? df.format(truncated / 10d) + suffix : df.format(truncated / 10) + suffix;
    }

    //map active channels
    public ArrayList<LndChannel> mapLndChannels(String content){
        ObjectMapper mapper = new ObjectMapper()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        ArrayList<LndChannel> lndChannels = new ArrayList<>();
        LndChannel lndChannel = new LndChannel();

        try {
            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("data")) {

                JSONArray jsonArray = jsonObject.getJSONArray("data");

                for (int i = 0; i < jsonArray.length(); i++) {

                    lndChannel = mapper.readValue(jsonArray.getJSONObject(i).toString(), LndChannel.class);
                    if (lndChannel.getLocal_balance() != null || lndChannel.getRemote_balance() != null) {
                        lndChannel.setLocalBalancePercent(lndChannel.getLocal_balance(), lndChannel.getRemote_balance());
                        lndChannel.setRemoteBalancePercent(lndChannel.getRemote_balance(), lndChannel.getLocal_balance());
                        lndChannels.add(lndChannel);
                    }
                }
            } else {
                return null;
            }
        }catch (JSONException | JsonProcessingException jsonException){
            logger.error(jsonException.toString());
            return null;
        }
        return lndChannels;
    }

    public LndChannel mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LndChannel lndChannel;

        try {
            lndChannel = mapper.readValue(content, LndChannel.class);

        } catch (Exception e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
            return null;
        }
        return lndChannel;
    }

    @Override
    public String toString(){
        return "\nLND Channel\n--------\n"
                + "Channel ID: " + this.getChan_id() + "\n"
                + "Active: " + this.isActive() + "\n"
                + "Remote PubKey: " + this.getRemote_pubkey() + "\n"
                + "Channel Point: " + this.getChannel_point() + "\n"
                + "Capacity: " + this.getCapacity() + "\n"
                + "Local Balance: " + this.getLocal_balance() + "\n"
                + "Remote Balance: " + this.getRemote_balance() + "\n"
                + "Commit Fee: " + this.getCommit_fee() + "\n"
                + "Commit Weight: " + this.getCommit_weight() + "\n"
                + "Fee Per KW: " + this.getFee_per_kw() + "\n"
                + "Unsettled Balance: " + this.getUnsettled_balance() + "\n"
                + "Total Satoshi Sent: " + this.getTotal_satoshis_sent() + "\n"
                + "Total Satoshi Received: " + this.getTotal_satoshis_received() + "\n"
                + "Local Balance Percent: " + this.getLocal_balance_percent() + "\n"
                + "Remote Balance Percent: " + this.getRemote_balance_percent() + "\n";
    }

    public String toJson() throws JsonProcessingException {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategy.SNAKE_CASE);
        return mapper.writeValueAsString(this);
    }
}
