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

public class TermsPolicy {
    private static Logger logger = LoggerFactory.getLogger(TermsPolicy.class);
    private String header;
    private String subheader;
    private ArrayList<String> description;
    private ArrayList<String> list;
    private ArrayList<String> links;

    public void setLinks(ArrayList<String> links) {
        this.links = links;
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

    public ArrayList<String> getLinks() {
        return links;
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
    public ArrayList<TermsPolicy> mapTermsPolicy() throws IOException, org.json.simple.parser.ParseException{
        JSONParser jsonParser = new JSONParser();
        ObjectMapper objectMapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        ArrayList<TermsPolicy> termsPolicies = new ArrayList<>();
        JSONObject jsonObject = new JSONObject(jsonParser.parse(new FileReader("json/termspolicy.json")).toString());

        if (jsonObject.has("terms")) {
            JSONArray jsonArray = jsonObject.getJSONArray("terms");
            for(int i=0;i<jsonArray.length();i++){
                TermsPolicy termsPolicy= objectMapper.readValue(jsonArray.getJSONObject(i).toString(),TermsPolicy.class);
                termsPolicies.add(termsPolicy);
            }
            return termsPolicies;
        }
        else{
            return null;
        }
    }
    public TermsPolicy mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        TermsPolicy termsPolicy = new TermsPolicy();
        try {

            termsPolicy = mapper.readValue(content, TermsPolicy.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return termsPolicy;
    }

    @Override
    public String toString() {
        return "TermsPolicyController{" +
                "header='" + header + '\'' +
                ", subheader='" + subheader + '\'' +
                ", description=" + description +
                ", list=" + list +
                ", links=" + links +
                '}';
    }
}
