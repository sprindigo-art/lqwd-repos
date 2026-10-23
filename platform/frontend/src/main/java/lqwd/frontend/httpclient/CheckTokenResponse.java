package lqwd.frontend.httpclient;

import com.fasterxml.jackson.databind.ObjectMapper;
import lqwd.frontend.controller.DesktopController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

public class CheckTokenResponse {

    private String[] aud;

    private String active;

    private Integer exp;

    private String user_name;

    private String client_id;

    private String[] scope;

    private static Logger logger = LoggerFactory.getLogger(CheckTokenResponse.class);

    public String[] getAud() {
        return aud;
    }

    public void setAud(String[] aud) {
        this.aud = aud;
    }

    public String getActive() {
        return active;
    }

    public void setActive(String active) {
        this.active = active;
    }

    public Integer getExp() {
        return exp;
    }

    public void setExp(Integer exp) {
        this.exp = exp;
    }

    public String getUser_name() {
        return user_name;
    }

    public void setUser_name(String user_name) {
        this.user_name = user_name;
    }

    public String getClient_id() {
        return client_id;
    }

    public void setClient_id(String client_id) {
        this.client_id = client_id;
    }

    public String[] getScope() {
        return scope;
    }

    public void setScope(String[] scope) {
        this.scope = scope;
    }


    public CheckTokenResponse mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper();
        CheckTokenResponse checkTokenResponse = new CheckTokenResponse();
        try {
            checkTokenResponse = (CheckTokenResponse) mapper.readValue(content, CheckTokenResponse.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return checkTokenResponse;
    }

    public boolean checkExpires_in(Long timeNowInSec) {
        if ((timeNowInSec - this.exp) > (this.exp - 10)) {
            return false;
        } else {
            return true;
        }

    }

    public boolean isValid() {
        return true;
    }
}
