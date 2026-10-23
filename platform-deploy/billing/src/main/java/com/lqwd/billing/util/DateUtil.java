package com.lqwd.billing.util;

import com.lqwd.billing.exceptions.BadRequestException;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;

public class DateUtil {

    public static Date validateDateFormat(String date, String format){
        try {
            return new SimpleDateFormat(format).parse(date);
            // good format
        } catch (ParseException e) {
            throw new BadRequestException(400, "Date should be in the format dd-MM-yyyy");
        }
    }
}
