package com.lqwd.thread;


import com.lqwd.schema.Tmessage;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
public class TmessagesList {
    private List<Tmessage> tmessages;

    private TmessagesList() {

    }

    public List<Tmessage> getInstance() {
        if (this.tmessages == null) {
            this.tmessages = new ArrayList<Tmessage>();
        }
        return this.tmessages;
    }

    public int size() {
        return this.tmessages.size();
    }

    public Tmessage getFirst(){
        if(this.tmessages.size() >0) {
            Tmessage tmessage = tmessages.get(0);
            tmessages.remove(0);
            return tmessage;
        }
        return null;
    }

    public void cleanList() {
        this.tmessages = new ArrayList<Tmessage>();
    }

    public void add(Tmessage tmessage) {
        this.tmessages.add(tmessage);
    }
}
