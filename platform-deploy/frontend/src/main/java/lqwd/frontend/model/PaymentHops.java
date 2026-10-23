package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.Setter;
import org.json.JSONArray;
import org.json.JSONObject;

import java.math.BigInteger;
import java.util.ArrayList;

@Getter
@Setter
public class PaymentHops {


    @JsonAlias({"chan_id", "chanId"})
    private BigInteger chan_id;

    @JsonAlias({"chan_capacity", "chanCapacity"})
    private Integer chan_capacity;

    @JsonAlias({"amt_to_forward", "amtToForward"})
    private Integer amt_to_forward;

    private Integer fee;

    private Integer expiry;

    @JsonAlias({"amt_to_forward_msat", "amtToForwardMsat"})
    private Integer amt_to_forward_msat;

    @JsonAlias({"fee_msat", "feeMsat"})
    private Integer fee_msat;

    @JsonAlias({"pubkey", "pub_key", "pubKey"})
    private String pub_key;

    @JsonAlias({"tlv_payload", "tlvPayload"})
    private boolean tlv_payload;

    private String alias;

    @Override
    public String toString(){
        return "Payment Hops \n" +
                "Chan ID - " + this.getChan_id() + "\n" +
                "Chan Capacity - " + this.getChan_capacity() + "\n" +
                "Amt to Forward - " + String.valueOf(this.getAmt_to_forward()) + "\n" +
                "Fee - " + String.valueOf(this.getFee()) + "\n" +
                "Expiry - " + String.valueOf(this.getExpiry()) + "\n" +
                "Amt to Forward MSAT - " + String.valueOf(this.getAmt_to_forward_msat()) + "\n" +
                "Fee MSAT - " + String.valueOf(this.getFee_msat()) + "\n" +
                "Pubkey - " + this.getPub_key() + "\n" +
                "Alias - " + this.getAlias() + "\n" +
                "TLV Payload - " + String.valueOf(this.isTlv_payload());
    }
}
