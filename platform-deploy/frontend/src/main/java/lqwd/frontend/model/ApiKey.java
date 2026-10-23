package lqwd.frontend.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;

public class ApiKey implements Serializable {

    private String apikey;

    private String status;

    private Date created;

    private Date expired;

    private String totalElements;

    private ArrayList<Requests> requests;

    private static Logger logger = LoggerFactory.getLogger(ApiKey.class);

    public ApiKey(){
        this.requests = new ArrayList<Requests>();
    }

    public ApiKey(String apikey){
        this.apikey = apikey;
        this.requests = new ArrayList<Requests>();
    }

    public ApiKey(String apikey, String status){
        this.apikey = apikey;
        this.status = status;
        this.created = Calendar.getInstance().getTime();
        this.requests = new ArrayList<Requests>();
    }

    public ApiKey(String apikey, String status, Date created){
        this.apikey = apikey;
        this.status = status;
        this.created = created;
        this.requests = new ArrayList<Requests>();
    }

    public String getApikey() {
        return apikey;
    }

    public void setApikey(String apikey) {
        this.apikey = apikey;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Date getCreated() {
        return created;
    }

    public void setCreated(Date created) {
        this.created = created;
    }

    public Date getExpired(){ return expired; }

    public void setExpired(Date expiry_date){ this.expired = expiry_date; }

    public String getTotalElements() {
        return totalElements;
    }

    public void setTotalElements(String totalElements) {
        this.totalElements = totalElements;
    }

    public ArrayList<Requests> getRequests() {
        return requests;
    }

    public void setRequests(ArrayList<Requests> requests) {
        this.requests = requests;
    }

    public ArrayList<Requests> mapApiRequestsContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            JSONObject jsonObject = new JSONObject(content);

            if(jsonObject.has("content")) {
                JSONArray jsonArray = jsonObject.getJSONArray("content");

                for (int i = 0; i < jsonArray.length(); i++) {

                    Requests requests = new Requests();
                    requests = mapper.readValue(jsonArray.getJSONObject(i).toString(), Requests.class);
                    this.requests.add(requests);
                }
            }else {
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());

        }
        return this.requests;
    }

    public ApiKey mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        ApiKey apiKey = new ApiKey();
        try {

            JsonNode jsonNodeRoot = mapper.readTree(content);
//            logger.info(jsonNodeRoot.get("object").asText());
            apiKey = mapper.readValue(jsonNodeRoot.get("object").asText(), ApiKey.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return apiKey;
    }

    @Override
    public String toString() {

        return "\nApiKey\n-----\n"
                + "PubKey: " + this.getApikey() + "\n"
                + "Status: " + this.getStatus() + "\n"
                + "Creation Date: " + this.getCreated();
    }
}
