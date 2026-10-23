package com.lqwd.thread;

import com.lqwd.schema.BackEndReply;
import com.lqwd.schema.TmessageKey;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@Component
public class BackEndMapList {

    private Map<TmessageKey, BackEndReply> messageMapList;

    private BackEndMapList(){}

    public Map<TmessageKey, BackEndReply> getInstance(){
        if(this.messageMapList == null){
            this.messageMapList = new HashMap<TmessageKey,BackEndReply>();
        }
        return this.messageMapList;
    }

    public int size() {
        return this.messageMapList.size();
    }

    public BackEndReply getAndRemoveTmessage(TmessageKey tmessageKey){
        if(this.messageMapList.size() >0) {
            BackEndReply backEndReply = messageMapList.get(tmessageKey);
            messageMapList.remove(tmessageKey);
            return backEndReply;
        }
        return null;
    }

    public String getUsername(TmessageKey tmessageKey){
        if(this.messageMapList.size() >0) {
            BackEndReply backEndReply = messageMapList.get(tmessageKey);
            String username = (String) backEndReply.getUsername();

            return username;
        }
        return null;
    }

    public Map.Entry<TmessageKey, BackEndReply> getAndRemove(TmessageKey tmessageKey){
        if(this.messageMapList.size() >0) {
            for ( Map.Entry<TmessageKey, BackEndReply> entry: this.messageMapList.entrySet()) {
                if(entry.getKey().equals(tmessageKey)){
                    return entry;
                }

            }

        }
        return null;
    }

    public Map.Entry<TmessageKey, BackEndReply> getFirst(){
        if(this.messageMapList.size() > 0){
            return messageMapList.entrySet().iterator().next();
        }
        return null;
    }

    public Set<TmessageKey> getKeys(){
        return this.messageMapList.keySet();
    }

    public void cleanList() {
        this.messageMapList = new HashMap<>();
    }

    public void add(TmessageKey tmessageKey, BackEndReply backEndReply) {
        this.messageMapList.put(tmessageKey, backEndReply);
    }

}
