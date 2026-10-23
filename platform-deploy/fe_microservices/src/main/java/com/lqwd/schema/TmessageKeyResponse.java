package com.lqwd.schema;

public class TmessageKeyResponse {
    private int id;

    private String  taction;

    public TmessageKeyResponse(int id, String taction){
        this.id = id;
        this.taction = taction;
    }

    public TmessageKeyResponse(TmessageKey tmessageKey){
        this.id =tmessageKey.getId();
        if(tmessageKey.getTactionName() != null) this.taction = tmessageKey.getTactionName().toString();

    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getTaction() {
        return taction;
    }

    public void setTaction(String taction) {
        this.taction = taction;
    }

    @Override
    public String toString(){
        return "tkey : id-> "+ this.id + ", taction->" + this.taction;
    }
}
