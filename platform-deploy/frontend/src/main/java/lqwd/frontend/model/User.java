package lqwd.frontend.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.jboss.aerogear.security.otp.api.Base32;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotEmpty;
import java.io.IOException;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.lang.*;
import java.util.stream.Collectors;


public class User implements Serializable {

    private String id;

    private String fa2secret;

    @Email(message = "Please Provide Valid Email")
    @NotEmpty(message = "Please Provide Valid Email")
    private String email;

    @NotEmpty(message = "Please Provide Valid Username")
    private String username;

  //  @Length(min = 5, message = "*Your password must have at least 5 characters")
    @NotEmpty(message = "Please Provide Valid Password")
    private String password;

    private String firstName;

    private String lastName;

    public String phone;

    private int active;

    private String roles;

    private ArrayList<ApiKey> apiKeyList;

    private String token;

    private String currency;

    //two factor auth variables
    private boolean fa2;

    //promotional news
    private boolean receiveNews;

    private static Logger logger = LoggerFactory.getLogger(User.class);

    private boolean emailstatus;

    private AccountInfo accountInfo;

    private LndNode lndNode;

    private ArrayList<LndNode> lndNodes;


    private List<String> role_s;


    public User(){
        super();
        this.fa2secret = Base32.random();
        this.apiKeyList = new ArrayList<ApiKey>();
        this.lndNodes = new ArrayList<LndNode>();
        this.currency = null;
    }

    public User(String email, String password){
        this.email = email;
        this.password = password;
        this.apiKeyList = new ArrayList<ApiKey>();
        this.lndNodes = new ArrayList<LndNode>();
        this.fa2secret = Base32.random();
        this.currency = null;
    }

    public User(String username, String email, String password){
        this.username = username;
        this.email=email;
        this.password = password;
        this.apiKeyList = new ArrayList<ApiKey>();
        this.lndNodes = new ArrayList<LndNode>();
        this.fa2secret = Base32.random();
        this.currency = null;
    }

    public User(String email, String password, String firstName, String lastName){
        this.email = email;
        this.password = password;
        this.firstName = firstName;
        this.lastName = lastName;
        this.apiKeyList = new ArrayList<ApiKey>();
        this.lndNodes = new ArrayList<LndNode>();
        this.fa2secret = Base32.random();
        this.currency = null;
    }

    public User(String username, String email,  String password, String firstName, String lastName){
        this.email = email;
        this.username = username;
        this.password = password;
        this.firstName = firstName;
        this.lastName = lastName;
        this.apiKeyList = new ArrayList<ApiKey>();
        this.lndNodes = new ArrayList<LndNode>();
        this.fa2secret = Base32.random();
        this.currency = null;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getFa2secret(){ return fa2secret;}

    public void setFa2secret(String fa2secret){
            this.fa2secret = fa2secret;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getUsername() { return username; }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getFullName() {
        return this.getFirstName() + " " + this.getLastName();
    }

    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = firstName;
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = lastName;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public int getActive() {
        return active;
    }

    public void setActive(int active) {
        this.active = active;
    }

    public String getRoles() {
        return roles;
    }

    public void setRoles(String roles) {
        this.roles = roles;
    }

    public boolean isFa2() {
        return fa2;
    }

    public void setFa2(boolean fa2) {
        this.fa2 = fa2;
    }

    public boolean isReceiveNews() {
        return receiveNews;
    }

    public void setReceiveNews(boolean receiveNews) {
        this.receiveNews = receiveNews;
    }

    public boolean isEmailstatus(){
        return emailstatus;
    }

    public void setEmailstatus(boolean emailstatus) {
        this.emailstatus = emailstatus;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public String getCurrency() {
        return currency;
    }

    public ArrayList<ApiKey> getApiKeyList() {

        return apiKeyList;
    }

    public void setApiKeyList(ArrayList<ApiKey> apiKeyList) {
        this.apiKeyList = apiKeyList;
    }

    public void addApiKeyList(ApiKey apiKey){

        if(apiKey.getStatus().equals("deactivated") || apiKey.getStatus().equals("deleted")){
            this.apiKeyList.add(this.apiKeyList.size(), apiKey);
        }else {
            this.apiKeyList.add(0, apiKey);
        }
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public AccountInfo getAccountInfo() {
        return accountInfo;
    }

    public void setAccountInfo(AccountInfo accountInfo) {
        this.accountInfo = accountInfo;
    }

    public LndNode getLndNode() {
        return lndNode;
    }

    public void setLndNode(LndNode lndNode) {
        this.lndNode = lndNode;
    }

    public ArrayList<LndNode> getLndNodes() {
        return lndNodes;
    }

    public void setLndNodes(ArrayList<LndNode> lndNodes) {
        this.lndNodes = lndNodes;
    }

    public List<String> getRole_s() {
        return role_s;
    }

    public void setRole_s(List<String> role_s) {
        this.role_s = role_s;
    }

    public User mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        User user = new User();
        try {

            JsonNode jsonNodeRoot = mapper.readTree(content);

            if (jsonNodeRoot.has("object")) {
                user = mapper.readValue(jsonNodeRoot.get("object").asText(), User.class);
            }

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return user;
    }

    public User mapApiKeyContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {

            JSONObject jsonObject = new JSONObject(content);
            List<String> list = new ArrayList<String>();

            if(jsonObject.has("object")){
                JSONObject jsonObject1 = new JSONObject(jsonObject.getString("object"));

                if(jsonObject1.has("apikey")){
                    JSONArray jsonArray = new JSONArray(jsonObject1.getString("apikey"));
                    for(int i = 0 ; i < jsonArray.length(); i++) {

                        if(jsonArray.getJSONObject(i).has("apikey")) {
                            list.add(jsonArray.getJSONObject(i).getString("apikey"));

                            ApiKey apiKey = new ApiKey();
                            apiKey = mapper.readValue(jsonArray.getJSONObject(i).toString(), ApiKey.class);
                            this.addApiKeyList(apiKey);
                        }
                    }
                }else{
                    return null;
                }
            }else{
                return null;
            }

        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());

        }
        return this;
    }

    public ArrayList<LndNode> mapLndNodes(String content){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        try {
            JSONObject jsonObject = new JSONObject(content);
            List<String> list = new ArrayList<String>();
            if(jsonObject.has("object") && jsonObject.get("object").getClass().equals(String.class)) {

                JSONArray jsonArray = new JSONArray(jsonObject.getString("object"));

                for (int i = 0; i < jsonArray.length(); i++) {

                    ApiKey apiKey = new ApiKey();
                    this.lndNode = mapper.readValue(jsonArray.getJSONObject(i).toString(), LndNode.class);
                    this.lndNodes.add(this.lndNode);
                }
            }else{
                logger.error(content);
                return null;
            }
        } catch (JsonProcessingException jsonMappingException) {
            logger.error(jsonMappingException.toString());
            return null;

        }
        return this.lndNodes;
    }

    @Override
    public String toString(){

        return "\nUser: " + this.getId() + "\n"
                + "Username: " + this.getUsername() + "\n"
                + "Full Name: " + this.getFullName() + "\n"
                + "First Name: " + this.getFirstName() + "\n"
                + "Last Name: " + this.getLastName() + "\n"
                + "Email: " + this.getEmail() + "\n"
                + "2FA: " + this.isFa2() + "\n"
                + "ReceiveNews: " + this.isReceiveNews() + "\n"
                + "Verified: " + this.isEmailstatus() + "\n"
                + "Token: " + this.getToken()+ "\n"
                + "Roles : " + this.getRole_s();
    }
}
