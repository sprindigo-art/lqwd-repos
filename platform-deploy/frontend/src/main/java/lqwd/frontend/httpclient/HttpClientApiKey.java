package lqwd.frontend.httpclient;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import lqwd.frontend.configuration.GlobalProperties;
import lqwd.frontend.model.ApiKey;
import lqwd.frontend.model.Requests;
import lqwd.frontend.model.User;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.NameValuePair;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.List;


@Component
public class HttpClientApiKey {
    private static Logger logger = LoggerFactory.getLogger(HttpClientLnd.class);

    @Value("${app.auth_post_url}")
    private String appAuthPostUrl;

    @Value("${app.auth_password}")
    private String appAuthPassword;

    @Value("${app.auth_user_name}")
    private String appAuthUserName;

    @Value("${app.auth_post_port}")
    private String appAuthPostPort;

    @Value("${app.auth_client_id}")
    private String appAuthClientId;


    @Value("${app.lndap_url}")
    private String apiKey_url;

    @Value("${app.lndap_port}")
    private String apiKey_port;

    @Value("${app.auth_grand_type}")
    private String authGrandType;

    //template method to get all required post request from backend
    private String getPostRequest(List<NameValuePair> params, String token, String action) throws UnsupportedEncodingException {
        String content = null;
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(15*1000);
        requestBuilder.setConnectionRequestTimeout(15*1000);
        requestBuilder.setSocketTimeout(15*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s",appAuthPostUrl,appAuthPostPort,action));

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");

        if(token != null){
            postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        }



        HttpEntity entity = new UrlEncodedFormEntity(params);
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {

                content = EntityUtils.toString(httpResponse.getEntity());
//                System.out.println(content);
                Gson gson = new GsonBuilder().setPrettyPrinting().create();
                JsonParser jp = new JsonParser();
                JsonElement je = jp.parse(content);
                String prettyJsonString = gson.toJson(je);

//                System.out.println(prettyJsonString);
//                System.out.println("----------------------------------------------------");

                return content;

            } else if (statusCode == 403) {
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return null;
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
            return null;
        }

        return content;
    }

    //POST Request method with custom content type
    private String getPostRequest(List<NameValuePair> params, String token, String action, String contentType) throws UnsupportedEncodingException {
        String content = null;
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(15*1000);
        requestBuilder.setConnectionRequestTimeout(15*1000);
        requestBuilder.setSocketTimeout(15*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s%s",appAuthPostUrl,appAuthPostPort,action));

        postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
        postRequest.addHeader(HttpHeaders.CONTENT_TYPE, contentType);

        if(token != null){
            postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Bearer "+token);
        }



        HttpEntity entity = new UrlEncodedFormEntity(params);
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 204) {
                logger.error("{status:204; content:NO_CONTENT}");
                return null;
            } else if (statusCode == 200) {

                content = EntityUtils.toString(httpResponse.getEntity());
//                System.out.println(content);
                Gson gson = new GsonBuilder().setPrettyPrinting().create();
                JsonParser jp = new JsonParser();
                JsonElement je = jp.parse(content);
                String prettyJsonString = gson.toJson(je);

//                System.out.println(prettyJsonString);
//                System.out.println("----------------------------------------------------");

                return content;

            } else if (statusCode == 403) {
                logger.error("{\"status\":403,\"error\":\"Forbidden\",\"message\":\"Session expired\",\"path\":\"/login\"}");
                return null;
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
            return null;
        }

        return content;
    }

    //generate new api key given username and password
    public String generateApiKey(User user) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        if(user.getEmail() == null){
            params.add(new BasicNameValuePair("username", user.getUsername()));
        }else {
            params.add(new BasicNameValuePair("username", user.getEmail()));
        }
        params.add(new BasicNameValuePair("password", user.getPassword()));

//        System.out.println(user.getToken());
        content = getPostRequest(params, user.getToken(), "/setting/apikey/generate");
        return content;
//
    }

    //get all api keys associated with user token account
    public String getListOfKeys(String token) throws UnsupportedEncodingException {
        String content = null;
        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("token", token));

        content = getPostRequest(params, token, "/setting/apikey/getlist");
        return content;
    }

    //deactivate api key
    public String deactivateApiKey(User user, String apikey, String token) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        if(user.getEmail() != null) {
            params.add(new BasicNameValuePair("username", user.getEmail()));
        }else{
            params.add(new BasicNameValuePair("username", user.getUsername()));
        }

        params.add(new BasicNameValuePair("password", user.getPassword()));
        params.add(new BasicNameValuePair("apikey", apikey));

        content = getPostRequest(params, token, "/setting/apikey/deactivate");

        return content;
    }

    //get total requests made with api key
    public String getApiTotalElements(String token, String apikey) throws UnsupportedEncodingException {
        String content = null;

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("apikey", apikey));
        params.add(new BasicNameValuePair("page", "1"));
        params.add(new BasicNameValuePair("size", "1"));

        content = getPostRequest(params, token, "/setting/apikey/history");
        JSONObject jsonObject = new JSONObject(content);
        if (jsonObject.has("totalElements")) {
            return String.valueOf(jsonObject.get("totalElements"));
        }else{
            return null;
        }
    }

    //get api key history of requests
    public ArrayList<Requests> getApiRequestHistory(String token, String pubkey, String num_elements_per_page, String page_number) throws UnsupportedEncodingException {
        String content = null;
        ArrayList<Requests> requests = new ArrayList<>();
        ApiKey apikey = new ApiKey();

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("apikey", pubkey));
        params.add(new BasicNameValuePair("page", page_number));
        params.add(new BasicNameValuePair("size", num_elements_per_page));

        content = getPostRequest(params, token, "/setting/apikey/history");
        if(content != null){
            requests =  apikey.mapApiRequestsContent(content);
            return requests;
        }
        return requests;
    }


}
