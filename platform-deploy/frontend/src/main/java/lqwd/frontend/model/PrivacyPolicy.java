package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json.JSONObject;
import org.json.simple.parser.JSONParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.FileReader;
import java.io.IOException;
import java.text.ParseException;
import java.util.ArrayList;
public class PrivacyPolicy {
    private static Logger logger = LoggerFactory.getLogger(PrivacyPolicy.class);
    private String header;
    private String subheader;
    private String subsubheader;
    private ArrayList<String> description;
    private ArrayList<String> list;


    public void setSubsubheader(String subsubheader) {
        this.subsubheader = subsubheader;
    }

    public String getSubsubheader() {
        return subsubheader;
    }


    public void setList(ArrayList<String> list) {
        this.list = list;
    }

    public void setDescription(ArrayList<String> description) {
        this.description = description;
    }

    public void setSubheader(String subheader) {
        this.subheader = subheader;
    }

    public void setHeader(String header) {
        this.header = header;
    }



    public ArrayList<String> getList() {
        return list;
    }

    public ArrayList<String> getDescription() {
        return description;
    }

    public String getSubheader() {
        return subheader;
    }

    public String getHeader() {
        return header;
    }
    public ArrayList<PrivacyPolicy> mapPrivacyPolicies() throws IOException, org.json.simple.parser.ParseException{
        JSONParser jsonParser = new JSONParser();
        ObjectMapper objectMapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        ArrayList<PrivacyPolicy> privacyPolicies = new ArrayList<>();
        JSONObject jsonObject = new JSONObject(jsonParser.parse(new FileReader("json/privacypolicy.json")).toString());

        if (jsonObject.has("privacy")) {
            JSONArray jsonArray = jsonObject.getJSONArray("privacy");
            for(int i=0;i<jsonArray.length();i++){
                PrivacyPolicy privacyPolicy= objectMapper.readValue(jsonArray.getJSONObject(i).toString(),PrivacyPolicy.class);
                privacyPolicies.add(privacyPolicy);
            }
            return privacyPolicies;
        }
        else{
            return null;
        }
    }
    public PrivacyPolicy mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        PrivacyPolicy privacyPolicy = new PrivacyPolicy();
        try {

            privacyPolicy = mapper.readValue(content, PrivacyPolicy.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return privacyPolicy;
    }
    @Override
    public String toString() {
        return "PrivacyPolicy{" +
                "header='" + header + '\'' +
                ", subheader='" + subheader + '\'' +
                ", subsubheader='" + subsubheader + '\'' +
                ", description=" + description +
                ", list=" + list +
                '}';
    }
}
