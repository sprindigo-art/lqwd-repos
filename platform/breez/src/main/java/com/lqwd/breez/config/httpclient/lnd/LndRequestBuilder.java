package com.lqwd.breez.config.httpclient.lnd;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public class LndRequestBuilder {
    protected HashMap<String,Object> requestObject = new HashMap<String,Object>();

    public static LndRequestBuilder newInstance(){
        return new LndRequestBuilder();
    }

    public Map<String,Object> build(){
        return  Collections.unmodifiableMap(requestObject);
    }

    public LndRequestBuilder add(String field, Object data){
        requestObject.put(field,data);
        return this;
    }

}
