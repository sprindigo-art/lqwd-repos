package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lqwd.frontend.controller.DesktopController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Date;

public class Requests {

    private String apikey;

    private String command;

    private Date date;

    private static Logger logger = LoggerFactory.getLogger(Requests.class);

    public Requests(){
    }

    public String getApikey(){
        return apikey;
    }

    public void setApikey(String apikey){
        this.apikey = apikey;
    }

    public Date getDate() {
        return date;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public String getCommand() {
        return command;
    }

    public void setCommand(String command) {
        this.command = command;
    }

    public Requests mapContent(String content){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        Requests request = new Requests();
        try {

            JsonNode jsonNodeRoot = mapper.readTree(content);
            request = mapper.readValue(jsonNodeRoot.get("content").asText(), Requests.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return request;
    }
}
