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

public class CookiePolicy {
        private static Logger logger = LoggerFactory.getLogger(lqwd.frontend.model.CookiePolicy.class);
        private String header;
        private String subheader;
        private ArrayList<String> description;
        private ArrayList<String> list;
        private String linktext;
        private String links;

    public void setLinktext(String linktext) {
        this.linktext = linktext;
    }

    public String getLinktext() {
        return linktext;
    }

        public void setLinks(String links) {
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

        public String getLinks() {

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



        public ArrayList<CookiePolicy> mapCookiePolicies() throws IOException, org.json.simple.parser.ParseException{
            JSONParser jsonParser = new JSONParser();
            ObjectMapper objectMapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            ArrayList<CookiePolicy> cookiePolicies = new ArrayList<>();
            JSONObject jsonObject = new JSONObject(jsonParser.parse(new FileReader("json/cookiespolicy.json")).toString());

            if (jsonObject.has("cookies")) {
                JSONArray jsonArray = jsonObject.getJSONArray("cookies");
                for(int i=0;i<jsonArray.length();i++){
                    CookiePolicy cookiePolicy= objectMapper.readValue(jsonArray.getJSONObject(i).toString(), CookiePolicy.class);
                    cookiePolicies.add(cookiePolicy);
                }
                return cookiePolicies;
            }
            else{
                return null;
            }
        }
        public CookiePolicy mapContent(String content) {
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

            CookiePolicy cookiePolicy = new CookiePolicy();
            try {
                cookiePolicy = mapper.readValue(content, CookiePolicy.class);

            } catch (IOException e) {
//            e.printStackTrace();
                logger.error(e.getMessage());
            }
            return cookiePolicy;
        }

    @Override
    public String toString() {
        return "CookiePolicy{" +
                "header='" + header + '\'' +
                ", subheader='" + subheader + '\'' +
                ", description=" + description +
                ", list=" + list +
                ", linktext='" + linktext + '\'' +
                ", links='" + links + '\'' +
                '}';
    }
}


