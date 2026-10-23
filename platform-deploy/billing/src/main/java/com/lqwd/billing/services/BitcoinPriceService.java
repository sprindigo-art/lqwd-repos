package com.lqwd.billing.services;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import com.lqwd.billing.entities.BitcoinPrice;
import com.lqwd.billing.repositories.BitcoinPriceRepository;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.util.EntityUtils;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.sql.Date;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Service
public class BitcoinPriceService {

    @Value("${app.coinmarketcap-api}")
    private String coinmarketcap_api;

    private final BitcoinPriceRepository bitcoinPriceRepository;

    Logger logger = LoggerFactory.getLogger(BitcoinPriceService.class);

    public BitcoinPriceService(BitcoinPriceRepository bitcoinPriceRepository) {
        this.bitcoinPriceRepository = bitcoinPriceRepository;
    }

    public boolean isJson(String content){
        try{
            JSONObject jsonObject = new JSONObject(content);
        }catch (JSONException jsonException){
            return false;
        }
        return true;
    }

    public BitcoinPrice getBitcoinPriceUSD() throws IOException {
        String content = null;

        BitcoinPrice bitcoinPrice = new BitcoinPrice();
        SimpleDateFormat simpleDateFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ");
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10*1000);
        requestBuilder.setConnectionRequestTimeout(10*1000);
        requestBuilder.setSocketTimeout(10*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpGet getRequest = new HttpGet("https://pro-api.coinmarketcap.com/v2/tools/price-conversion?id=1&amount=1&convert=USD");

        getRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        getRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        getRequest.addHeader("X-CMC_PRO_API_KEY", coinmarketcap_api);

        //get USD
        try (CloseableHttpResponse httpResponse = client.execute(getRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 200) {
                if (isJson(content)) {
                    JSONObject jsonObject = new JSONObject(content);
                    if (jsonObject.has("data")) {
                        JSONObject coinData = jsonObject.getJSONObject("data");
                        if (coinData.has("quote")) {
                            JSONObject quote = coinData.getJSONObject("quote");
                            if (quote.has("USD") && quote.get("USD") != null) {
                                bitcoinPrice.setUsd(quote.getJSONObject("USD").getDouble("price"));
                                bitcoinPrice.setLast_updated(simpleDateFormat.parse(quote.getJSONObject("USD").getString("last_updated").replace("Z", "UTC")) );
                            }
                        }
                    }
                }
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        }catch(JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
        }catch (IOException | ParseException e) {
            logger.error(e.getMessage());
        }

        //get CAD


        return bitcoinPrice;
    }

    public BitcoinPrice getBitcoinPriceCAD() throws IOException {
        String content = null;

        BitcoinPrice bitcoinPrice = new BitcoinPrice();
        SimpleDateFormat simpleDateFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ");
        RequestConfig.Builder requestBuilder = RequestConfig.custom();
        requestBuilder.setConnectTimeout(10*1000);
        requestBuilder.setConnectionRequestTimeout(10*1000);
        requestBuilder.setSocketTimeout(10*1000);

        CloseableHttpClient client = HttpClientBuilder.create().setDefaultRequestConfig(requestBuilder.build()).build();

        HttpGet getRequest = new HttpGet("https://pro-api.coinmarketcap.com/v2/tools/price-conversion?id=1&amount=1&convert=CAD");

        getRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        getRequest.addHeader(HttpHeaders.ACCEPT, "application/json");

        getRequest.addHeader("X-CMC_PRO_API_KEY", coinmarketcap_api);

        getRequest.addHeader(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded");
        getRequest.addHeader(HttpHeaders.ACCEPT, "application/json");


        //get USD
        try (CloseableHttpResponse httpResponse = client.execute(getRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 200) {
                if (isJson(content)) {
                    JSONObject jsonObject = new JSONObject(content);
                    if (jsonObject.has("data")) {
                        JSONObject coinData = jsonObject.getJSONObject("data");
                        if (coinData.has("quote")) {
                            JSONObject quote = coinData.getJSONObject("quote");
                            if (quote.has("CAD") && quote.get("CAD") != null) {
                                bitcoinPrice.setCad(quote.getJSONObject("CAD").getDouble("price"));
                                bitcoinPrice.setLast_updated(simpleDateFormat.parse(quote.getJSONObject("CAD").getString("last_updated").replace("Z", "UTC")));
                            }
                        }
                    }
                }
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        }catch(JsonParseException jsonParseException) {
            logger.error(jsonParseException.getMessage());
        }catch (IOException | ParseException e) {
            logger.error(e.getMessage());
        }

        //get CAD


        return bitcoinPrice;
    }
}
