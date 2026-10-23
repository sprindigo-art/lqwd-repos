package com.lqwd.utils;

import java.util.Arrays;
import java.util.List;

public class LndUtil {

    public static boolean requiresAdminMacaroon(String command, String httpMethod) {

        if(!httpMethod.equalsIgnoreCase("GET"))
            return true;

        List<String> adminMacaroonRequiredCommands = Arrays.asList(
                "v1/newaddress"
        );

        return adminMacaroonRequiredCommands.contains(command);
    }

    public static String getMacaroonFile(String command, String httpMethod) {
        Boolean adminRequired =  requiresAdminMacaroon(command, httpMethod);
        String macaroonFile = "admin.macaroon";
        if(!adminRequired){
            macaroonFile = "readonly.macaroon";
        }
        return macaroonFile;
    }


}
