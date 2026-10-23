package lqwd.frontend.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.Setter;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
public class LndNode {

    private String status;

    private String lndNodeName;

    @JsonAlias({"externalip", "address"})
    private String externalip;

    private String description;

    private String port;

    private LndChannel channel;

    private ArrayList<LndChannel> activeChannels;

    private ArrayList<LndChannel> pendingChannels;

    private ArrayList<LndChannel> closedChannels;

    private LndNodeInfo lndNodeInfo;

    private WalletBalance walletBalance;

    @JsonAlias({"pub_key", "nodepubkey", "pubkey"})
    private String nodepubkey;

    private String domain;

    private String namespace;

    private String errorMessage;

    private Boolean isNonCustodial;

    private String network;

    private String litNodeName;

    private String ownerEmail;

    private String alias;

    private Boolean watchtower;

    private Boolean isRoutingNode;

    private Boolean isConfirmed;

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public String getErrorMessage() {
        return errorMessage;
    }


    private static Logger logger = LoggerFactory.getLogger(LndNode.class);

    public LndNode(){
        this.activeChannels = new ArrayList<LndChannel>();
        this.pendingChannels = new ArrayList<LndChannel>();
        this.closedChannels = new ArrayList<LndChannel>();
        this.lndNodeInfo = new LndNodeInfo();
    }

    public LndNode(String lndNodeName, String externalip){
        this.lndNodeName = lndNodeName;
        this.externalip = externalip;
        this.lndNodeInfo = new LndNodeInfo();
        this.activeChannels = new ArrayList<LndChannel>();
        this.pendingChannels = new ArrayList<LndChannel>();
        this.closedChannels = new ArrayList<LndChannel>();

    }
    public String getLndNodeName() {
        return lndNodeName;
    }

    public void setLndNodeName(String name) {
        this.lndNodeName = name;
    }

    public String getExternalip() {
        return externalip;
    }

    public void setExternalip(String externalip) {
        this.externalip = externalip;
    }

    public ArrayList<LndChannel> getActiveChannels() {
        return activeChannels;
    }

    public void setActiveChannels(ArrayList<LndChannel> channels) {
        this.activeChannels = channels;
    }

    public void addActiveChannel(LndChannel channel){
        this.activeChannels.add(channel);
    }

    public ArrayList<LndChannel> getPendingChannels() {
        return pendingChannels;
    }

    public void setPendingChannels(ArrayList<LndChannel> pendingChannels) {
        this.pendingChannels = pendingChannels;
    }

    public ArrayList<LndChannel> getClosedChannels() {
        return closedChannels;
    }

    public void setClosedChannels(ArrayList<LndChannel> closedChannels) {
        this.closedChannels = closedChannels;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getStatus() {
        return status;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }

    public String getPort() {
        return port;
    }

    public void setPort(String port) {
        this.port = port;
    }

    public WalletBalance getWalletBalance() {
        return walletBalance;
    }

    public void setWalletBalance(WalletBalance walletBalance) {
        this.walletBalance = walletBalance;
    }

    public LndNodeInfo getLndNodeInfo() {
        return lndNodeInfo;
    }

    public void setLndNodeInfo(LndNodeInfo lndNodeInfo) {
        this.lndNodeInfo = lndNodeInfo;
    }

    public String getNodepubkey() {
        return nodepubkey;
    }

    public void setNodepubkey(String nodepubkey) {
        this.nodepubkey = nodepubkey;
    }

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }

    public boolean isWatchtower() {
        return watchtower;
    }

    public void setWatchtower(boolean watchtower) {
        this.watchtower = watchtower;
    }

    public String getDomain() {
        return domain;
    }

    public void setDomain(String domain) {
        this.domain = domain;
    }

    //map active channels
    public ArrayList<LndChannel> mapLndChannels(String content){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        ArrayList<LndChannel> lndChannels = new ArrayList<>();
        LndChannel lndChannel = new LndChannel();

        try {

            JSONObject jsonObject = new JSONObject(content);

            if (jsonObject.has("data")) {

                JSONArray jsonArray = jsonObject.getJSONArray("data");

                for (int i = 0; i < jsonArray.length(); i++) {

                    lndChannel = mapper.readValue(jsonArray.getJSONObject(i).toString(), LndChannel.class);
                    lndChannel.setLocalBalancePercent(lndChannel.getLocal_balance(), lndChannel.getRemote_balance());
                    lndChannel.setRemoteBalancePercent(lndChannel.getRemote_balance(), lndChannel.getLocal_balance());
                    lndChannels.add(lndChannel);
                }
            } else {
                return null;
            }
        }catch (JSONException | JsonProcessingException jsonException){
            logger.error(jsonException.toString());
            return null;
        }
        return lndChannels;
    }

    //map pending channels
    public ArrayList<LndChannel> mapPendingLndChannels(String content){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            JSONObject jsonObject = new JSONObject(content);
            List<String> list = new ArrayList<String>();

            if (jsonObject.has("pending_open_channels")) {

                JSONArray jsonArray = jsonObject.getJSONArray("pending_open_channels");

                for (int i = 0; i < jsonArray.length(); i++) {
                    if (jsonArray.getJSONObject(i).has("channel")) {
                        this.channel = mapper.readValue(jsonArray.getJSONObject(i).getJSONObject("channel").toString(), LndChannel.class);
                        this.channel.setLocalBalancePercent(this.channel.getLocal_balance(), this.channel.getRemote_balance());
                        this.channel.setRemoteBalancePercent(this.channel.getRemote_balance(), this.channel.getLocal_balance());
                        this.pendingChannels.add(this.channel);
                    }
                }
            } else {
                return null;
            }
        }catch (JSONException | JsonProcessingException jsonException){
            logger.error(jsonException.toString());
            return null;
        }
        return this.pendingChannels;
    }

    //map closed channels
    public ArrayList<LndChannel> mapClosedLndChannels(String content){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            JSONObject jsonObject = new JSONObject(content);
            List<String> list = new ArrayList<String>();

            if (jsonObject.has("pending_open_channels")) {

                JSONArray jsonArray = jsonObject.getJSONArray("pending_open_channels");

                for (int i = 0; i < jsonArray.length(); i++) {
                    if (jsonArray.getJSONObject(i).has("channel")) {
                        this.channel = mapper.readValue(jsonArray.getJSONObject(i).getJSONObject("channel").toString(), LndChannel.class);
                        this.closedChannels.add(this.channel);
                    }
                }
            } else {
                return null;
            }
        }catch (JSONException | JsonProcessingException jsonException){
            logger.error(jsonException.toString());
            return null;
        }
        return this.closedChannels;
    }

    public LndNode mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LndNode lndNode = new LndNode();
        try {

            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("object")) {
                lndNode = mapper.readValue(jsonObject.getString("object"), LndNode.class);
            }
        } catch (Exception e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
            return null;
        }
        return lndNode;
    }

    public LndNode mapNodeInfo(String content){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        LndNode lndNode = new LndNode();
        try {

            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("node")) {
                lndNode = mapper.readValue(jsonObject.getJSONObject("node").toString(), LndNode.class);
            }
        } catch (Exception e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
            return null;
        }
        return lndNode;
    }


    //map lqwd nodes from json
    public ArrayList<LndNode> lqwdNodes() throws IOException, ParseException {
        JSONParser jsonParser = new JSONParser();

        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        ArrayList<LndNode> lndNodes = new ArrayList<>();

        JSONObject jsonObject = new JSONObject(jsonParser.parse(new FileReader("json/lqwd-nodes.json")).toString());

        if(jsonObject.has("nodes")) {
            JSONArray jsonArray = jsonObject.getJSONArray("nodes");

            for (int i = 0; i < jsonArray.length(); i++) {
                LndNode lndNode = mapper.readValue(jsonArray.getJSONObject(i).toString(), LndNode.class);
                lndNodes.add(lndNode);
            }

            return  lndNodes;

        }else{
            return null;
        }
    }

    @Override
    public String toString() {

        return "LndNode{" +
                "status='" + status + '\'' +
                ", alias='" + alias + '\'' +
                ", lndNodeName='" + lndNodeName + '\'' +
                ", externalip='" + externalip + '\'' +
                ", description='" + description + '\'' +
                ", port='" + port + '\'' +
                ", ownerEmail='" + ownerEmail + '\'' +
                ", channel=" + channel +  '\'' +
                ", activeChannels=" + activeChannels +  '\'' +
                ", pendingChannels=" + pendingChannels +  '\'' +
                ", closedChannels=" + closedChannels +  '\'' +
                ", walletBalance='" + walletBalance + '\'' +
                ", nodepubkey='" + nodepubkey + '\'' +
                ", namespace='" + namespace + '\'' +
                ", isNonCustodial='" + isNonCustodial + '\'' +
                ", isRoutingNode='" + isRoutingNode + '\'' +
                ", isConfirmed='" + isConfirmed + '\'' +
                ", litNodeName='" + litNodeName + '\'' +
                ", watchtower=" + watchtower +
                '}';
    }
}