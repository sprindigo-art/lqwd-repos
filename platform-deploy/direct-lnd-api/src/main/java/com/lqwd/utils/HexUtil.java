package com.lqwd.utils;

import org.apache.commons.codec.binary.Hex;

import java.util.Base64;

public class HexUtil {

    public static String flipHexString(String hexString){
        StringBuilder sb = new StringBuilder(hexString.length());
        char[] ca = hexString.toCharArray();
        for (int i = 0; i<hexString.length();i+=2)
        {
            sb.insert(0, ca, i, 2);
        }

        return sb.toString();
    }

    public static String base64ToHex(String base64){
        byte[] decoded = Base64.getDecoder().decode(base64.getBytes());
        return Hex.encodeHexString(decoded);
    }
}
