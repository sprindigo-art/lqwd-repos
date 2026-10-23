package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lqwd.frontend.controller.DesktopController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

public class AccountInfo {

    private String status;

    private String plan;

    private String name;

    private String description;

    private static Logger logger = LoggerFactory.getLogger(AccountInfo.class);

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPlan() {
        return plan;
    }

    public void setPlan(String plan) {
        this.plan = plan;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public AccountInfo mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        AccountInfo accountInfo = new AccountInfo();
        try {

            JsonNode jsonNodeRoot = mapper.readTree(content);

            accountInfo = mapper.readValue(jsonNodeRoot.get("object").asText(), AccountInfo.class);

        } catch (IOException e) {
            logger.error(e.getMessage());
//            e.printStackTrace();

        }
        return accountInfo;
    }

    @Override
    public String toString(){

        return "\nName: " + this.getName() + "\n"
                + "Status: " + this.getStatus() + "\n"
                + "Plan: " + this.getPlan() + "\n"
                + "Description: " + this.getDescription();
    }
}
