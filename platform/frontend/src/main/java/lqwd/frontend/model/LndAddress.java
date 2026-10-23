package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.Setter;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@Getter
@Setter
public class LndAddress {

    @JsonProperty("id")
    private String id;

    @JsonProperty("nodeName")
    private String nodeName;

    @JsonProperty("userId")
    private String userId;

    @JsonProperty("address")
    private String address;

    @JsonProperty("dateCreated")
    private Date dateCreated;

    private static Logger logger = LoggerFactory.getLogger(LndAddress.class);

    public LndAddress mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LndAddress lndAddress = new LndAddress();
        try {

            lndAddress = mapper.readValue(content, LndAddress.class);

        } catch (IOException e) {
            logger.error(e.getMessage());
        }
        return lndAddress;
    }


    public ArrayList<LndAddress> mapListAddress(String content){

        ArrayList<LndAddress> lndAddresses = new ArrayList<>();

        JSONObject jsonObject = new JSONObject(content);

        if(jsonObject.has("data")){
            JSONArray jsonArray = jsonObject.getJSONArray("data");

            for(int i = 0 ; i < jsonArray.length(); i++) {
                LndAddress lndAddress = this.mapContent(jsonArray.getJSONObject(i).toString());
                lndAddresses.add(lndAddress);
            }

        }else{
            return null;
        }

        return lndAddresses;
    }
}
