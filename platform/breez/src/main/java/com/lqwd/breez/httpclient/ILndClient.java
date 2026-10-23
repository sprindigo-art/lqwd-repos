package com.lqwd.breez.httpclient;

import com.lqwd.breez.dto.response.InvoiceCreateResponse;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.POST;
import java.util.Map;


public interface ILndClient {

    @POST("v1/invoices")
    Call<InvoiceCreateResponse> createInvoice(@Body Map<String,Object> data);

}
