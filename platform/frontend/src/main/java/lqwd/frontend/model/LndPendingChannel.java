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
import java.util.List;

@Getter
@Setter
public class LndPendingChannel {

    @JsonAlias({"total_limbo_balance", "totalLimboBalance"})
    private Double total_limbo_balance;

    @JsonAlias({"commit_fee", "commitFee"})
    private String commit_fee;

    @JsonAlias({"commit_weight", "commitWeight"})
    private String commit_weight;

    @JsonAlias({"fee_per_kw", "feePerKw"})
    private String fee_per_kw;

    @JsonAlias({"channel_point", "channelPoint"})
    private String channel_point;

    @JsonAlias({"remote_node_pub", "remoteNodePub", "remote_pubkey", "remotePubKey", "remotePubkey"})
    private String remote_node_pub;

    @JsonAlias("capacity")
    private Double capacity;

    @JsonAlias({"local_balance", "localBalance"})
    private Double local_balance;

    @JsonAlias({"remote_balance", "remoteBalance"})
    private Double remote_balance;

    @JsonAlias({"local_chan_reserve_sat", "localChanReserveSat"})
    private Double local_chan_reserve_sat;

    @JsonAlias({"remote_chan_reserve_sat", "remoteChanReserveSat"})
    private Double remote_chan_reserve_sat;

    @JsonAlias({"initiator", "isInitiator"})
    private String initiator;

    @JsonAlias({"num_forwarding_packages", "numForwardingPackages"})
    private Integer num_forwarding_packages;

    @JsonAlias({"chan_status_flags", "chanStatusFlags"})
    private String chan_status_flags;

    @JsonAlias({"private", "isPrivate"})
    private boolean isPrivate;

    @JsonAlias({"commitment_type", "commitmentType"})
    private String commitment_type;

    @JsonAlias({"txId", "tx_id"})
    private String tx_id;

    @JsonAlias({"dateCreated", "date_created"})
    private Date date_created;

    private String type;

    private static Logger logger = LoggerFactory.getLogger(LndPendingChannel.class);

    public LndPendingChannel mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LndPendingChannel lndPendingChannel;

        try {
            lndPendingChannel = mapper.readValue(content, LndPendingChannel.class);

        } catch (Exception e) {
            logger.error(e.getMessage());
            return null;
        }
        return lndPendingChannel;
    }

    public ArrayList<LndPendingChannel> mapContentList(String content){
        ObjectMapper mapper = new ObjectMapper()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            JSONObject jsonObject = new JSONObject(content);
            ArrayList<LndPendingChannel> lndPendingChannels = new ArrayList<>();
            if (jsonObject.has("data")) {

                JSONArray jsonArray = jsonObject.getJSONArray("data");

                for (int i = 0; i < jsonArray.length(); i++) {
                    LndPendingChannel lndPendingChannel = mapper.readValue(jsonArray.getJSONObject(i).toString(), LndPendingChannel.class);
                    if (lndPendingChannel.getType().equals("PENDING_OPEN_CHANNEL")) {
                        lndPendingChannels.add(lndPendingChannel);
                    }
                }
                return lndPendingChannels;
            } else {
                return null;
            }
        }catch (JSONException | JsonProcessingException jsonException){
            logger.error(jsonException.toString());
            return null;
        }
    }

    public String toJson() throws JsonProcessingException {
        ObjectMapper mapper = new ObjectMapper();
        mapper.setPropertyNamingStrategy(PropertyNamingStrategy.SNAKE_CASE);
        return mapper.writeValueAsString(this);
    }
}
