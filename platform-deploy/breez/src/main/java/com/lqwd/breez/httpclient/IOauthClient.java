package com.lqwd.breez.httpclient;
import com.github.lianjiatech.retrofit.spring.boot.annotation.RetrofitClient;

import com.github.lianjiatech.retrofit.spring.boot.retry.Retry;
import com.lqwd.breez.config.httpclient.HttpResponseErrorDecoder;
import com.lqwd.breez.dto.response.ApikeyResponse;
import retrofit2.Call;
import retrofit2.http.GET;
import retrofit2.http.Query;


/**
 * Oauth Retrofit Interface
 *
 * List all api calls that will be made to oauth server
 */
@RetrofitClient(baseUrl = "http://${app.auth_post_url}:${app.auth_post_port}", errorDecoder= HttpResponseErrorDecoder.class)
@Retry(maxRetries = 0)//used to specify how many time retrofit will retry making http calls if there are failures.
public interface IOauthClient {

    @GET("apikey/authorize")
    Call<String> authorizeViaApiKey(@Query("apikey") String apiKey);

}
