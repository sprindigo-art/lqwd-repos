package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import lombok.Getter;
import lombok.Setter;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Date;

@Getter
@Setter
public class LndClosedChannel {

    @JsonAlias({"remote_pubkey", "remotePubKey", "remotePubkey"})
    private String remote_pubkey;

    @JsonAlias({"channel_point", "channelPoint"})
    private String channel_point;

    @JsonAlias({"chan_id", "channelId", "channel_id"})
    private String chan_id;

    @JsonAlias({"chan_hash", "chainHash"})
    private String chain_hash;

    @JsonAlias({"closing_tx_hash", "closingTxHash"})
    private String closing_tx_hash;

    @JsonAlias("capacity")
    private String capacity;

    @JsonAlias({"close_height", "closeHeight"})
    private Double close_height;

    @JsonAlias({"settled_balance", "settledBalance"})
    private String settled_balance;

    @JsonAlias({"time_locked_balance", "timeLockedBalance"})
    private String time_locked_balance;

    @JsonAlias({"close_type", "closeType"})
    private String close_type;

    @JsonAlias("type")
    private String type;

    @JsonAlias({"initiator"})
    private boolean initiator;

    @JsonAlias({"openInitiator", "open_initiator"})
    private String open_initiator;

    @JsonAlias({"close_initiator", "closeInitiator"})
    private String close_initiator;

    @JsonAlias({"date_modified", "dateModified"})
    private Date date_modified;

    @JsonAlias({"date_created", "dateCreated"})
    private Date date_created;

    @JsonAlias({"local_balance", "localBalance"})
    private String local_balance;

    @JsonAlias({"remote_balance", "remoteBalance"})
    private String remote_balance;

    @JsonAlias({"unsettled_balance", "unsetledBalance"})
    private String unsettled_balance;

    @JsonAlias({"total_satoshis_sent", "totalSatoshisSent"})
    private String total_satoshis_sent;

    @JsonAlias({"total_satoshis_received", "totalSatoshisReceived"})
    private String total_satoshis_received;

    private static Logger logger = LoggerFactory.getLogger(LndClosedChannel.class);

    public LndClosedChannel mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LndClosedChannel lndClosedChannel;

        try {
            lndClosedChannel = mapper.readValue(content, LndClosedChannel.class);

        } catch (Exception e) {
            logger.error(e.getMessage());
            return null;
        }
        return lndClosedChannel;
    }

    public ArrayList<LndClosedChannel> mapContentList(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            JSONObject jsonObject = new JSONObject(content);
            ArrayList<LndClosedChannel> lndClosedChannels = new ArrayList<>();
            if (jsonObject.has("data")) {

                JSONArray jsonArray = jsonObject.getJSONArray("data");

                for (int i = 0; i < jsonArray.length(); i++) {
                    LndClosedChannel lndClosedChannel = mapper.readValue(jsonArray.getJSONObject(i).toString(), LndClosedChannel.class);
                    lndClosedChannels.add(lndClosedChannel);
                }
                return lndClosedChannels;
            } else {
                return null;
            }
        }catch (JSONException | JsonProcessingException jsonException){
            logger.error(jsonException.toString());
            return null;
        }
    }

    @Override
    public String toString(){
        return "\nLND CLose Channel\n--------\n"
                + "Channel ID: " + this.getChan_id() + "\n"
                + "Remote PubKey: " + this.getRemote_pubkey() + "\n"
                + "Channel Point: " + this.getChannel_point() + "\n"
                + "Capacity: " + this.getCapacity() + "\n"
                + "Closing TX Hash: " + this.getClosing_tx_hash() + "\n"
                + "Open Initiator: " + this.getOpen_initiator() + "\n"
                + "Close Initiator: " + this.getClose_initiator() + "\n"
                + "Date Created: " + this.getDate_created() + "\n"
                + "Date Modified: " + this.getDate_modified() + "\n"
                + "Local Balance: " + this.getLocal_balance() + "\n"
                + "Remote Balance: " + this.getRemote_balance() + "\n"
                + "Unsettled Balance: " + this.getUnsettled_balance() + "\n"
                + "Total Satoshi Sent: " + this.getTotal_satoshis_sent() + "\n"
                + "Total Satoshi Received: " + this.getTotal_satoshis_received();
    }

    public String toJson() throws JsonProcessingException {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategy.SNAKE_CASE);
        return mapper.writeValueAsString(this);
    }
}
