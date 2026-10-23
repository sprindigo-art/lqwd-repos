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

public class DlaRequest {
    private static Logger logger = LoggerFactory.getLogger(DlaRequest.class);
    public String path;
    public ArrayList<String> headers;
    public ArrayList<String> params;
    public String responseSuccess;
    public ArrayList<String> responseError;

    public String getPath() {
        return path;
    }

    public ArrayList<String> getResponseError() {
        return responseError;
    }

    public String getResponseSuccess() {
        return responseSuccess;
    }

    public ArrayList<String> getParams() {
        return params;
    }

    public ArrayList<String> getHeaders() {
        return headers;
    }

    public void setResponseError(ArrayList<String> responseError) {
        this.responseError = responseError;
    }

    public void setResponseSuccess(String responseSuccess) {
        this.responseSuccess = responseSuccess;
    }

    public void setParams(ArrayList<String> params) {
        this.params = params;
    }

    public void setHeaders(ArrayList<String> headers) {
        this.headers = headers;
    }

    public void setPath(String path) {
        this.path = path;
    }
    public DlaRequest mapContent(String content) {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        DlaRequest dlaRequest = new DlaRequest();
        try {

            dlaRequest = mapper.readValue(content, DlaRequest.class);

        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }
        return dlaRequest;
    }
 public ArrayList<DlaRequest> mapDlaReqests() throws IOException, org.json.simple.parser.ParseException {
     JSONParser jsonParser = new JSONParser();
     ObjectMapper objectMapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
     ArrayList<DlaRequest> dlaRequests = new ArrayList<>();
     JSONObject jsonObject = new JSONObject(jsonParser.parse(new FileReader("json/dlarequests.json")).toString());

     if (jsonObject.has("dlarequests")) {
        JSONArray jsonArray = jsonObject.getJSONArray("dlarequests");
        for(int i=0;i<jsonArray.length();i++){
            DlaRequest dlaRequest= objectMapper.readValue(jsonArray.getJSONObject(i).toString(),DlaRequest.class);
            dlaRequests.add(dlaRequest);
        }
        return dlaRequests;
    }
    else{
        return null;
    }

 }
    @Override
    public String toString() {
        return "DLA Request\n" +
                "Path: " + this.getPath() +"\n" +
                "Headers: " + this.getHeaders() +"\n" +
                "Params: " + this.getParams() +"\n" +
                "Response_Success: " + this.getResponseSuccess() +"\n" +
                "Response_error: " + this.getResponseError();
    }
}
