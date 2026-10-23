package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lqwd.frontend.controller.DesktopController;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

public class WalletBalance {

    private long total_balance;

    private long confirmed_balance;

    private long unconfirmed_balance;

    private static Logger logger = LoggerFactory.getLogger(WalletBalance.class);

    public WalletBalance(){}

    public long getTotal_balance() {
        return total_balance;
    }

    public void setTotal_balance(long total_balance) {
        this.total_balance = total_balance;
    }

    public long getConfirmed_balance() {
        return confirmed_balance;
    }

    public void setConfirmed_balance(long confirmed_balance) {
        this.confirmed_balance = confirmed_balance;
    }

    public long getUnconfirmed_balance() {
        return unconfirmed_balance;
    }

    public void setUnconfirmed_balance(long unconfirmed_balance) {
        this.unconfirmed_balance = unconfirmed_balance;
    }

    public WalletBalance mapContent(String content) {
        WalletBalance walletBalance = new WalletBalance();
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        if (content != null) {
            JSONObject jsonObject = new JSONObject(content);

            JSONObject jsobj = new JSONObject();
            if (jsonObject.has("total_balance")) {
                jsobj.put("total_balance", jsonObject.get("total_balance"));
                jsobj.put("confirmed_balance", jsonObject.get("confirmed_balance"));
                jsobj.put("unconfirmed_balance", jsonObject.get("unconfirmed_balance"));
            }

            try {
                walletBalance = mapper.readValue(jsobj.toString(), WalletBalance.class);
            } catch (IOException e) {
                logger.error(e.getMessage());
            }
            return walletBalance;
        }
        return null;

    }

    @Override
    public java.lang.String toString(){
        return "Wallet Balance: " + "\n"
                + "Total Balance: " + this.getTotal_balance() + "\n"
                + "Confirmed Balance: " + this.getConfirmed_balance() + "\n"
                + "Unconfirmed Balance: " + this.getUnconfirmed_balance();
    }
}
