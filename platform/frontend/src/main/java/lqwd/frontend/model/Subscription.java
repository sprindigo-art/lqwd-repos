package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;

import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;

public class Subscription {

    private static Logger logger = LoggerFactory.getLogger(Subscription.class);


    private String tier;

    private ArrayList<String> description;

    private String priceMonth;

    private String priceYear;

    private String title;

    private String tagline;

    public String getTier() {
        return tier;
    }

    public void setTier(String tier) {
        this.tier = tier;
    }

    public ArrayList<String> getDescription() {
        return description;
    }

    public void setDescription(ArrayList<String> description) {
        this.description = description;
    }

    public String getPriceMonth() {
        return priceMonth;
    }

    public void setPriceMonth(String priceMonth) {
        this.priceMonth = priceMonth;
    }

    public String getPriceYear() {
        return priceYear;
    }

    public void setPriceYear(String priceYear) {
        this.priceYear = priceYear;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getTagline() {
        return tagline;
    }

    public void setTagline(String tagline) {
        this.tagline = tagline;
    }

    public Subscription mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        Subscription subscription = new Subscription();
        try {

            subscription = mapper.readValue(content, Subscription.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return subscription;
    }

    public ArrayList<Subscription> mapSubscriptionTypes() throws IOException, ParseException {

        JSONParser jsonParser = new JSONParser();

        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        ArrayList<Subscription> subscriptions = new ArrayList<>();

        JSONObject jsonObject = new JSONObject(jsonParser.parse(new FileReader("json/subscriptions.json")).toString());

        if(jsonObject.has("subscriptions")) {
            JSONArray jsonArray = jsonObject.getJSONArray("subscriptions");

            for (int i = 0; i < jsonArray.length(); i++) {
                Subscription subscription = mapper.readValue(jsonArray.getJSONObject(i).toString(), Subscription.class);
                subscriptions.add(subscription);
            }

            return  subscriptions;
        }else{
            return null;
        }
    }

    @Override
    public String toString(){
        return "Subscription\n" +
                "Tier: " + this.getTier() +"\n" +
                "Title: " + this.getTitle() +"\n" +
                "Tagline: " + this.getTagline() +"\n" +
                "Description: " + this.getDescription() +"\n" +
                "Price Month: " + this.getPriceMonth() +"\n" +
                "Price Year: " + this.getPriceYear();
    }
}
