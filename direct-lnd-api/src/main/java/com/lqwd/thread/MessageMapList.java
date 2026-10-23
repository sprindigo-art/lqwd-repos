package com.lqwd.thread;

import com.lqwd.schema.Tmessage;
import com.lqwd.schema.TmessageKey;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
public class MessageMapList {

    private Map<TmessageKey, Tmessage> messageMapList;

    private MessageMapList(){}

    public Map<TmessageKey, Tmessage> getInstance(){
        if(this.messageMapList == null){
            this.messageMapList = new HashMap<TmessageKey,Tmessage>();
        }
        return this.messageMapList;
    }

    public int size() {
        return this.messageMapList.size();
    }

    public Tmessage getAndRemoveTmessage(TmessageKey tmessageKey){
        if(this.messageMapList.size() >0) {
            Tmessage tmessage = messageMapList.get(tmessageKey);
            messageMapList.remove(tmessageKey);
            return tmessage;
        }
        return null;
    }

    public Map.Entry<TmessageKey, Tmessage> getAndRemove(TmessageKey tmessageKey){
        if(this.messageMapList.size() >0) {
            for ( Map.Entry<TmessageKey, Tmessage> entry: this.messageMapList.entrySet()) {
                if(entry.getKey().equals(tmessageKey)){
                    return entry;
                }

            }

        }
        return null;
    }

    public Map.Entry<TmessageKey, Tmessage> getFirst(){
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

    public void add(TmessageKey tmessageKey, Tmessage tmessage) {
        this.messageMapList.put(tmessageKey, tmessage);
    }
}
