package com.lqwd.interfaces;

import com.github.lianjiatech.retrofit.spring.boot.annotation.RetrofitClient;
import com.github.lianjiatech.retrofit.spring.boot.retry.Retry;
import com.lqwd.config.HttpResponseErrorDecoder;
import com.lqwd.model.response.TokenResponse;
import com.lqwd.model.response.UserResponse;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.http.*;

import java.util.Map;


/**
 * Oauth Retrofit Interface
 *
 * List all api calls that will be made to oauth server
 */
@RetrofitClient(baseUrl = "http://${app.auth_post_url}:${app.auth_post_port}", errorDecoder= HttpResponseErrorDecoder.class)
@Retry(maxRetries = 0)//used to specify how many time retrofit will retry making http calls if there are failures.
public interface IOauthClient {

    @FormUrlEncoded
    @POST("oauth/token")
    @Headers("Cache-Control: max-age=640000")
    Call<TokenResponse> getToken(@Header("Authorization") String authorization,
                                 @Field("username") String username,
                                 @Field("password") String password,
                                 @Field("grant_type") String grantType,
                                 @Field("scope") String scope
                          );

    @FormUrlEncoded
    @POST("oauth/token")
    Call<TokenResponse> getClientToken(@Header("Authorization") String authorization,
                                 @Field("grant_type") String grantType
    );


    @POST("lndnode/update")
    @FormUrlEncoded
    Call<ResponseBody> updateNodeInfo(@Header("Authorization") String authorization,
                                      @Field("nodepubkey") String nodepubkey,
                                      @Field("lndNodeName") String lndNodeName,
                                      @Field("status") String status
    );

    @GET("registration/userinfo")
    Call<UserResponse> getUserInfo(@Header("Authorization") String authorization);

}
