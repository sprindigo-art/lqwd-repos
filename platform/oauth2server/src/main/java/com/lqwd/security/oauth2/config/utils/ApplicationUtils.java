package com.lqwd.security.oauth2.config.utils;

public class ApplicationUtils {

    public static Boolean getBoolean(Boolean bool){
        if(bool != null){
            return bool.booleanValue();
        }else{
            return false;
        }
    }
    public static String STAKING_ROLE = "STAKING";
    public static String LIQUIDITY_ROLE = "LIQUIDITY";
}
