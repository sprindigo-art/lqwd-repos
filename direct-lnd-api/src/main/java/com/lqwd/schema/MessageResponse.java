package com.lqwd.schema;


import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;

@JsonSerialize(include = JsonSerialize.Inclusion.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class MessageResponse {
    private TmessageKeyResponse tmessageKey;
    private TmessageResponse tmessage;

    public MessageResponse(TmessageKeyResponse tmessageKey, TmessageResponse tmessage){
        this.tmessageKey = tmessageKey;
        this.tmessage = tmessage;
    }

    public TmessageKeyResponse getTmessageKey() {
        return tmessageKey;
    }

    public void setTmessageKey (TmessageKeyResponse tmessageKey) {
        this.tmessageKey = tmessageKey;
    }

    public TmessageResponse getTmessage() {
        return tmessage;
    }

    public void setTmessage(TmessageResponse tmessage) {
        this.tmessage = tmessage;
    }

    @Override
    public String toString() {
        return "MessageResponse{" +
                "tmessageKey=" + tmessageKey +
                ", tmessage=" + tmessage +
                '}';
    }
}
