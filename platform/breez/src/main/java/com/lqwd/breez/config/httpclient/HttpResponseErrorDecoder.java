package com.lqwd.breez.config.httpclient;

import com.github.lianjiatech.retrofit.spring.boot.core.ErrorDecoder;
import com.github.lianjiatech.retrofit.spring.boot.exception.ReadResponseBodyException;
import com.github.lianjiatech.retrofit.spring.boot.exception.RetrofitException;
import com.github.lianjiatech.retrofit.spring.boot.util.RetrofitUtils;
import com.lqwd.breez.exceptions.ApiException;
import okhttp3.Request;
import okhttp3.Response;

public class HttpResponseErrorDecoder implements ErrorDecoder {

    RetrofitException ex;

    @Override
    public RuntimeException invalidRespDecode(Request request, Response response) {
        if (!response.isSuccessful()) {
            String responseBody = "Unknown error";
            try {
                responseBody = RetrofitUtils.readResponseBody(response);
            } catch (ReadResponseBodyException e) {
               // e.printStackTrace();
            }
            throw new ApiException(response.code(), responseBody);
        }
        return null;
    }
}
