package com.lqwd.utils;

import org.json.JSONException;
import org.json.JSONObject;

import javax.servlet.http.HttpServletRequest;

public class UserUtil {

    public static String retrieveUserId(String userInfoResponse) throws JSONException {
        JSONObject object = new JSONObject(userInfoResponse);
        return object.getString("id");
    }

    public static String retrieveUserEmail(String userInfoResponse) throws JSONException {
        JSONObject object = new JSONObject(userInfoResponse);
        return object.getString("email");
    }

    public static String retrieveUserFirstname(String userInfoResponse) throws JSONException {
        JSONObject object = new JSONObject(userInfoResponse);
        return object.getString("firstName");
    }

    public static String getClientIP(HttpServletRequest request) {
        String xfHeader = request.getHeader("X-FORWARDED-FOR");
        if (xfHeader == null) {
            return request.getRemoteAddr();
        }
        return xfHeader.split(",")[0];
    }
}
