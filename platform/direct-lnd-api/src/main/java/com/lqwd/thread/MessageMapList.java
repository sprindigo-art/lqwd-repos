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
            this.messageMapList = new HashMap<>();
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


    public Set<TmessageKey> getKeys(){
        return this.messageMapList.keySet();
    }

    public void add(TmessageKey tmessageKey, Tmessage tmessage) {
        this.messageMapList.put(tmessageKey, tmessage);
    }
}
