package com.lqwd.schema;

public class TmessageResponse {

    private int id;
    private String tmess;
    private String tdescription;
    private String  taction;
    private String  tdesignation;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getTmess() {
        return tmess;
    }

    public void setTmess(String tmess) {
        this.tmess = tmess;
    }

    public String getTdescription() {
        return tdescription;
    }

    public void setTdescription(String tdescription) {
        this.tdescription = tdescription;
    }

    public String getTaction() {
        return taction;
    }

    public void setTaction(String taction) {
        this.taction = taction;
    }

    public String getTdesignation() {
        return tdesignation;
    }

    public void setTdesignation(String tdesignation) {
        this.tdesignation = tdesignation;
    }

    public TmessageResponse(Tmessage tmessage){
        if(tmessage.getId() != null) this.id =tmessage.getId();
        if(tmessage.getTaction() != null) this.taction = tmessage.getTaction().toString();
        if(tmessage.getTmess() != null)this.tmess = tmessage.getTmess().toString();
        if(tmessage.getTdescription() != null)this.tdescription = tmessage.getTdescription().toString();
        if(tmessage.getTdesignation() != null) this.tdesignation = tmessage.getTdesignation().toString();
    }
}
