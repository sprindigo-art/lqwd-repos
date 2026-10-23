package com.lqwd.model;

import com.lqwd.config.AppProperties;
import lombok.Data;

@Data
public class LndConfigAdvancedParam {
    private String mainExternalHost = "ln.lqwd.tech";
    private String devExternalIp = "192.168.215.98";
    private String stageExternalIp = "192.168.215.98";
    private String prodExternalIp = "54.71.76.33";
    private String postgres = "1";
    private String namespace = "lqwd-lnd";
    private String forceUpdateConfig = "1";
    private String lndSeedExpSeconds = "600";
    private String lndNonCustodialValue = "0";

    private final AppProperties properties;

    public LndConfigAdvancedParam(AppProperties properties) {

        this.properties = properties;
    }

    public String getExternalHost(String lndNodeName){
        String externalHost = lndNodeName + "." + this.mainExternalHost;

        if(properties.getWenv().equals("stage")){
            externalHost = lndNodeName + ".ln-stage.lqwd.tech" ;
        }

        if(properties.getWenv().equals("development")){
            externalHost = lndNodeName + ".ln-dev.lqwd.tech" ;
        }

        return externalHost;
    }

    public String getExternalIp(){
        if(properties.getWenv().equals("stage")){
            return this.stageExternalIp;
        }
        if(properties.getWenv().equals("production")){
            return this.prodExternalIp;
        }
        return this.devExternalIp;
    }

    public String getWenv(){
        return properties.getWenv();
    }
}
