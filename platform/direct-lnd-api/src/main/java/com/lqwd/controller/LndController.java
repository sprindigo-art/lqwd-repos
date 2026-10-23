package com.lqwd.controller;

import com.lqwd.exceptions.BadRequestException;
import com.lqwd.factories.LNDDeploymentStrategyFactory;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;
import com.lqwd.model.entities.LndAddress;
import com.lqwd.model.entities.LndInteraction;
import com.lqwd.model.enums.DeploymentType;
import com.lqwd.model.request.ConfirmLndNodeRequest;
import com.lqwd.model.request.LndChannelStatusRequest;
import com.lqwd.model.request.LndInvoiceStatusRequest;
import com.lqwd.model.request.LndTransactionStatusRequest;
import com.lqwd.model.request.RestartLndNodeRequest;
import com.lqwd.model.request.SetNodeRunningRequest;
import com.lqwd.model.request.UnlockLndNodeRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.LNDResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.service.*;
import com.lqwd.utils.LndUtil;
import io.micrometer.core.instrument.util.StringUtils;
import lombok.RequiredArgsConstructor;
import org.apache.http.entity.ContentType;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.provider.OAuth2Authentication;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;


@RestController
@RequestMapping(value = "/lnd")
@RequiredArgsConstructor
public class LndController {

    public static final Logger logger = LoggerFactory.getLogger(LndController.class);

    private final LndHttpClient lndHttpClient;
    private final HttpClientToken httpClientToken;
    private final CommandHistoryService commandHistoryService;
    private final LndNodeService lndNodeService;
    private final LndInteractionService lndInteractionService;
    private final LNDDeploymentStrategyFactory lndDeploymentStrategyFactory;
    final static String LND_ERROR_KEY = "error";
    private final LndAddressService lndAddressService;
    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final ShareLndService shareLndService;

    @RequestMapping(value = "peer/status", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String peerStatus(@RequestHeader("lndname") String lndname,
                             @RequestHeader(value = "passphrase", required = false) String passphrase,
                             @RequestParam(value = "peerPubKey") String pubKey,
                             OAuth2Authentication authentication) throws Exception {


        MultiValueMap mMap = new LinkedMultiValueMap();

        String lndContent = runLndHttpClient("get",
                "v1/peers", authentication, lndname, mMap, passphrase);

        JSONObject jsonObject = new JSONObject(lndContent);
        if (jsonObject.has(LND_ERROR_KEY)) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), jsonObject.getString(LND_ERROR_KEY));
        }
        JSONArray peers = jsonObject.getJSONArray("peers");
        boolean pearConnected = false;

        for (int i = 0; i < peers.length(); i++) {
            String selectedPub = peers.getJSONObject(i).getString("pub_key");
            if (selectedPub.equals(pubKey)) {
                pearConnected = true;
                break;
            }
        }
        JSONObject responseObj = new JSONObject();
        responseObj.put("connected", pearConnected);
        return responseObj.toString();
    }


    @RequestMapping(value = "transaction/status", method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTransactionStatus(OAuth2Authentication authentication,
                                       @RequestHeader("lndname") String lndname,
                                       @RequestHeader(value = "passphrase", required = false) String passphrase,
                                       @RequestBody @Valid LndTransactionStatusRequest requestObj) throws Exception {


        MultiValueMap mMap = new LinkedMultiValueMap();

        String lndContent = runLndHttpClient("get",
                "v1/transactions", authentication, lndname, mMap, passphrase);
        logger.info(lndContent);

        JSONObject jsonObject = new JSONObject(lndContent);
        if (jsonObject.has(LND_ERROR_KEY)) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), jsonObject.getString(LND_ERROR_KEY));
        }
        JSONArray transactions = jsonObject.getJSONArray("transactions");
        boolean hasTransactionInList = false;
        int totalConfirmations = 0;

        for (int i = 0; i < transactions.length(); i++) {
            totalConfirmations = transactions.getJSONObject(i).getInt("num_confirmations");
            String tx_hash = transactions.getJSONObject(i).getString("tx_hash");
            if (tx_hash.equals(requestObj.getTransactionHash())) {
                hasTransactionInList = true;
                break;
            }
        }
        if (!hasTransactionInList) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Cannot find transaction");
        }
        JSONObject responseObj = new JSONObject();
        responseObj.put("status", totalConfirmations >= 3 ? "Confirmed" : "Pending");
        return responseObj.toString();
    }


    @RequestMapping(value = "invoice/status", method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getInvoiceStatus(
            OAuth2Authentication authentication,
            @RequestHeader("lndname") String lndname,
            @RequestHeader(value = "passphrase", required = false) String passphrase,
            @RequestBody @Valid LndInvoiceStatusRequest requestObj) throws Exception {


        MultiValueMap mMap = new LinkedMultiValueMap();


        String lndContent = runLndHttpClient("get",
                "v1/invoices", authentication, lndname, mMap, passphrase);


        JSONObject jsonObject = new JSONObject(lndContent);
        if (jsonObject.has(LND_ERROR_KEY)) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), jsonObject.getString(LND_ERROR_KEY));
        }
        JSONArray invoices = jsonObject.getJSONArray("invoices");
        boolean hasInoviceInList = false;
        boolean isSettled = false;

        for (int i = 0; i < invoices.length(); i++) {
            String payment_request = invoices.getJSONObject(i).getString("payment_request");
            if (payment_request.equals(requestObj.getPaymentRequest())) {
                isSettled = invoices.getJSONObject(i).getBoolean("settled");
                hasInoviceInList = true;
                break;
            }
        }
        if (!hasInoviceInList) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Cannot find invoice");
        }
        JSONObject responseObj = new JSONObject();
        responseObj.put("settled", isSettled);
        return responseObj.toString();
    }


    @RequestMapping(value = "channel/status", method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String channelStatus(
            OAuth2Authentication authentication,
            @RequestHeader("lndname") String lndname,
            @RequestHeader(value = "passphrase", required = false) String passphrase,
            @RequestBody @Valid LndChannelStatusRequest requestObj) throws Exception {


        MultiValueMap mMap = new LinkedMultiValueMap();



        String lndContent = runLndHttpClient("get",
                "v1/channels?active_only=true", authentication, lndname, mMap, passphrase);

        JSONObject jsonObject = new JSONObject(lndContent);
        if (jsonObject.has(LND_ERROR_KEY)) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), jsonObject.getString(LND_ERROR_KEY));
        }
        JSONArray channels = jsonObject.getJSONArray("channels");
        boolean channelActive = false;
        boolean isChannelInList = false;
        for (int i = 0; i < channels.length(); i++) {
            if (channels.getJSONObject(i).getString("chan_id").equals(requestObj.getChannelId())) {
                isChannelInList = true;
                channelActive = channels.getJSONObject(i).getBoolean("active");
                break;
            }
        }

        if (!isChannelInList) {
            throw new BadRequestException(HttpStatus.BAD_REQUEST.value(), "Cannot find channel");
        }
        JSONObject responseObj = new JSONObject();
        responseObj.put("active", channelActive);
        return responseObj.toString();
    }


    @ResponseBody
    @PostMapping(path = "/confirm")
    public ResponseEntity<MainResponse> confirmNode(@RequestBody @Valid ConfirmLndNodeRequest request, OAuth2Authentication authentication) {
        return ResponseEntity.ok(lndNodeService.confirmNode(request, authentication));
    }


    @PostMapping(path = "/unlockwallet")
    public ResponseEntity<?> unlockLndNodeWallet(@RequestBody @Valid UnlockLndNodeRequest request,
                                                 OAuth2Authentication authentication) {
        return ResponseEntity.ok(lndNodeService.unlockWallet(request, authentication));
    }

    @GetMapping(path = "/getseed")
    public ResponseEntity<?> getLndSeed(@RequestParam(name = "lndname", required = false) String lndname,
                                        OAuth2Authentication authentication) {
        logger.debug(" lnd node name " + lndname);
        return ResponseEntity.ok(lndNodeService.getSeed(lndname, authentication));
    }

    @PostMapping(path = "/setrunning")
    public ResponseEntity<?> setRunningStatus(@RequestBody @Valid SetNodeRunningRequest request,
                                              OAuth2Authentication authentication) {
        return ResponseEntity.ok(lndNodeService.setRunning(request.getLndname(), authentication));
    }

    @PostMapping(path = "restart")
    public ResponseEntity<?> restartLndNode(@RequestBody @Valid RestartLndNodeRequest request,
                                            OAuth2Authentication authentication) {
        return ResponseEntity.ok(lndNodeService.restartNode(request, authentication));
    }

    @RequestMapping(value = "send-payment", method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String sendPayment(OAuth2Authentication authentication,
                              @RequestHeader("lndname") String lndname,
                              @RequestHeader(value = "passphrase", required = false) String passphrase,
                              @RequestBody(required = false) Map<String, Object> values) throws Exception {

        String lndContent = runLndHttpClientJson("post",
                "v1/channels/transactions", authentication, lndname, values, passphrase);

        return lndContent;
    }


    @RequestMapping(value = "send-btc-payment", method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String sendBTCPayment(OAuth2Authentication authentication,
                                 @RequestHeader("lndname") String lndname,
                                 @RequestHeader(value = "passphrase", required = false) String passphrase,
                                 @RequestBody(required = false) Map<String, Object> values) throws Exception {

        String lndContent = runLndHttpClientJson("post", "v1/transactions", authentication, lndname, values, passphrase);

        logger.info(lndContent);
        return lndContent;
    }


    @GetMapping("/address/list")
    public ApiResponse<List<LndAddress>> createNewAddress(
            OAuth2Authentication authentication,
            @RequestHeader("lndname") String lndname) throws JSONException {
        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse response = httpClientToken.lndNodeInfo(token, lndname, "/lndnode/getinfo",
                "LndNodeInfo");
        if (response.getStatus() != 200)
            return new ApiResponse(response.getStatus(), null, "Cannot handle this request");
        return lndAddressService.getNodeAddresses(lndname);

    }


    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}/{p4}", "/v2/{p1}/{p2}/{p3}/{p4}"},
            method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage4(OAuth2Authentication authentication,
                                @RequestHeader("lndname") String lndname,
                                @RequestHeader(value = "passphrase", required = false) String passphrase,
                                HttpServletRequest request,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @PathVariable(required = false) Optional<String> p3,
                                @PathVariable(required = false) Optional<String> p4,
                                @RequestBody(required = false) Map<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";

        Boolean checkCountAccess = true;

        if (!checkCountAccess)
            return "{\"error\":\" You have reached your max number of request. Please try again later!\"}";

        if (p1.isPresent() && p2.isPresent() && p3.isPresent() && p4.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get() + "/" + p3.get() + "/" + p4.get();

            lndContent = runLndHttpClientJson("post", command, authentication, lndname, values, passphrase);
        }
        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}/{p4}", "/v2/{p1}/{p2}/{p3}/{p4}"},
            method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage4(OAuth2Authentication authentication,
                               @RequestHeader("lndname") String lndname,
                               HttpServletRequest request,
                               @PathVariable(required = false) Optional<String> p1,
                               @PathVariable(required = false) Optional<String> p2,
                               @PathVariable(required = false) Optional<String> p3,
                               @PathVariable(required = false) Optional<String> p4,
                               @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";

        if (p1.isPresent() && p2.isPresent() && p3.isPresent() && p4.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get() + "/" + p3.get() + "/" + p4.get();

          lndContent = runLndHttpClient("get", command, authentication, lndname, values, null);

        }
        return lndContent;

    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}/{p4}", "/v2/{p1}/{p2}/{p3}/{p4}"},
            method = RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage4(OAuth2Authentication authentication,
                                  @RequestHeader("lndname") String lndname,
                                  @RequestHeader(value = "passphrase", required = false) String passphrase,
                                  HttpServletRequest request,
                                  @PathVariable(required = false) Optional<String> p1,
                                  @PathVariable(required = false) Optional<String> p2,
                                  @PathVariable(required = false) Optional<String> p3,
                                  @PathVariable(required = false) Optional<String> p4,
                                  @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";


        if (p1.isPresent() && p2.isPresent() && p3.isPresent() && p4.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get() + "/" + p3.get() + "/" + p4.get();

          lndContent = runLndHttpClient("delete", command, authentication, lndname, values, passphrase);

        }
        return lndContent;

    }


    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}", "/v2/{p1}/{p2}/{p3}"},
            method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage3(OAuth2Authentication authentication,
                                @RequestHeader("lndname") String lndname,
                                @RequestHeader(value = "passphrase", required = false) String passphrase,
                                HttpServletRequest request,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @PathVariable(required = false) Optional<String> p3,
                                @RequestBody(required = false) Map<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";

        if (p1.isPresent() && p2.isPresent() && p3.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get() + "/" + p3.get();

            lndContent = runLndHttpClientJson("post", command, authentication, lndname, values, passphrase);

        }

        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}", "/v2/{p1}/{p2}/{p3}"},
            method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage3(OAuth2Authentication authentication,
                               @RequestHeader("lndname") String lndname,
                               HttpServletRequest request,
                               @PathVariable(required = false) Optional<String> p1,
                               @PathVariable(required = false) Optional<String> p2,
                               @PathVariable(required = false) Optional<String> p3,
                               @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";


        if (p1.isPresent() && p2.isPresent() && p3.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get() + "/" + p3.get();

            lndContent = runLndHttpClient("get", command, authentication, lndname, values, null);

        }

        return lndContent;

    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}", "/v2/{p1}/{p2}/{p3}"},
            method = RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage3(OAuth2Authentication authentication,
                                  @RequestHeader("lndname") String lndname,
                                  @RequestHeader(value = "passphrase", required = false) String passphrase,
                                  HttpServletRequest request,
                                  @PathVariable(required = false) Optional<String> p1,
                                  @PathVariable(required = false) Optional<String> p2,
                                  @PathVariable(required = false) Optional<String> p3,
                                  @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";

        if (p1.isPresent() && p2.isPresent() && p3.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get() + "/" + p3.get();

            lndContent = runLndHttpClient("delete", command, authentication, lndname, values, passphrase);

        }

        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}/{p2}", "/v2/{p1}/{p2}"},
            method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage2(OAuth2Authentication authentication,
                                @RequestHeader("lndname") String lndname,
                                @RequestHeader(value = "passphrase", required = false) String passphrase,
                                HttpServletRequest request,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @RequestBody(required = false) Map<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";


        if (p1.isPresent() && p2.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get();

            lndContent = runLndHttpClientJson("post", command, authentication, lndname, values, passphrase);

        }

        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}/{p2}", "/v2/{p1}/{p2}"},
            method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage2(OAuth2Authentication authentication,
                               @RequestHeader("lndname") String lndname,
                               HttpServletRequest request,
                               @PathVariable(required = false) Optional<String> p1,
                               @PathVariable(required = false) Optional<String> p2,
                               @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";

        if (p1.isPresent() && p2.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get();

            lndContent = runLndHttpClient("get", command, authentication, lndname, values, null);

        }

        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}/{p2}", "/v2/{p1}/{p2}"},
            method = RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage2(OAuth2Authentication authentication,
                                  @RequestHeader("lndname") String lndname,
                                  @RequestHeader(value = "passphrase", required = false) String passphrase,
                                  HttpServletRequest request,
                                  @PathVariable(required = false) Optional<String> p1,
                                  @PathVariable(required = false) Optional<String> p2,
                                  @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";

        Boolean checkCountAccess = true;

        if (!checkCountAccess)
            return "{\"error\":\" You have reached your max number of request. Please try again later!\"}";


        if (p1.isPresent() && p2.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get() + "/" + p2.get();

            lndContent = runLndHttpClient("delete", command, authentication, lndname, values, passphrase);

        }

        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}", "/v2/{p1}"},
            method = RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage(OAuth2Authentication authentication,
                               @RequestHeader("lndname") String lndname,
                               @RequestHeader(value = "passphrase", required = false) String passphrase,
                               HttpServletRequest request,
                               @PathVariable(required = false) Optional<String> p1,
                               @RequestBody(required = false) Map<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";

        if (p1.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get();

            lndContent = runLndHttpClientJson("post", command, authentication, lndname, values, passphrase);

        }

        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}", "/v2/{p1}"},
            method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage(OAuth2Authentication authentication,
                              @RequestHeader("lndname") String lndname,
                              HttpServletRequest request,
                              @PathVariable(required = false) Optional<String> p1,
                              @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {

        String lndContent = "{\"error\":\"Command not exist\"}";


        if (p1.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get();

            lndContent = runLndHttpClient("get", command, authentication, lndname, values, null);

        }

        return lndContent;


    }

    @RequestMapping(value = {"/v1/{p1}", "/v2/{p1}"},
            method = RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage(OAuth2Authentication authentication,
                                 @RequestHeader("lndname") String lndname,
                                 @RequestHeader(value = "passphrase", required = false) String passphrase,
                                 HttpServletRequest request,
                                 @PathVariable(required = false) Optional<String> p1,
                                 @RequestParam(required = false) MultiValueMap<String, Object> values) throws Exception {


        String lndContent = "{\"error\":\"Command not exist\"}";


        if (p1.isPresent()) {
            String spath = request.getRequestURL().toString();
            String firstPath = "v1/";
            if (spath.contains("/lnd/v2")) {
                firstPath = "v2/";
            }
            String command = firstPath + p1.get();

            lndContent = runLndHttpClient("delete", command, authentication, lndname, values, passphrase);

        }

        return lndContent;
    }

    @RequestMapping(value = {"/create/invoices/{p1}"},
            method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postCreateInvoice(OAuth2Authentication authentication,
                               @RequestHeader("lndname") String lndname,
                               @RequestHeader(value = "passphrase", required = false) String passphrase,
                               HttpServletRequest request,
                               @PathVariable(required = true) String p1) throws Exception {

        String lndContent = "{\"error\":\"Create Invoice Command not exist\"}";
        logger.info("create invoice start");

        Map<String, Object> mapValue = new HashMap<String, Object>();
        mapValue.put("value", Integer.valueOf(p1));
        String command ="/v1/invoices";
        logger.info(command + " :create Invoice ");
        lndContent = runLndHttpClientJson("post", command, authentication, lndname, mapValue, passphrase);

        return lndContent;


    }




    private String runLndHttpClient(String smethod,
                                    String command, OAuth2Authentication authentication, String lndname,
                                    MultiValueMap<String, Object> values, String passphrase) throws Exception {

        Optional<Map<String, Object>> data = values != null ?
                Optional.of(values.toSingleValueMap()) : Optional.empty();


        return runLNDRequest(smethod, command, authentication, lndname, passphrase, data);


    }

    private String runLndHttpClientJson(String smethod,
                                    String command, OAuth2Authentication authentication, String lndname,
                                    Map<String, Object> values, String passphrase) throws Exception {


        Optional<Map<String, Object>> data = values != null ?
                Optional.of(values) : Optional.empty();


        return runLNDRequest(smethod, command, authentication, lndname, passphrase, data);


    }

    private String runLNDRequest(String smethod, String command, OAuth2Authentication authentication, String lndname,
                                 String passphrase, Optional<Map<String, Object>> data) throws Exception {

        String token = accessTokenServiceHelper.getAccessTokenFromAuthentication(authentication);

        MainResponse mainResponse = httpClientToken.getNodeInfo(token, lndname);


        if (mainResponse.getStatus() == 200) {

            JSONObject jsonData = new JSONObject(mainResponse.getObject());
            String status;
            String lndNodeName;
            String nodeAddress;
            String roleName;

            try {

                status = (String) jsonData.get("status");
                lndNodeName = (String) jsonData.get("lndNodeName");
                String deploymentTypeStr = jsonData.getString("deploymentType");

               // we are checking access level for user command should be in a list of access action.
                roleName = (String) jsonData.get("nodeRole");

                if(!roleName.equals("OWNER") || roleName.equals("ADMIN")){

                    if(!shareLndService.checkActionLevel(authentication, lndname,command)) {

                        return "Access level exception. Please check your access level.";
                    }

                }

                DeploymentType deploymentType = DeploymentType.valueOf(deploymentTypeStr);

                nodeAddress = lndDeploymentStrategyFactory.getStrategy(deploymentType).getAddress(jsonData);


                boolean isNonCustodial = jsonData.getBoolean("isNonCustodial");

                if (isNonCustodial && !shouldProceedWithNonCustodialRequest(command, smethod, passphrase)) {
                    throw new BadRequestException(400, "Passphrase is required for non custodial nodes");
                }

                //reset passphrase
                passphrase = isNonCustodial ? passphrase : null;

            } catch (Exception e) {
                logger.info(mainResponse.toString());
                logger.info("An exception occurred when get NodeInfo: {}", e.getMessage());
                throw new BadRequestException(400, "An when occurred when retrieving your node info");
            }


            if (status.equalsIgnoreCase("RUNNING")) {

                LNDResponse lndContent;

                if (smethod.equals("post")) {

                    lndContent = lndHttpClient.postRequestToLndPod(command, nodeAddress, ContentType.APPLICATION_JSON,
                            data, lndNodeName, passphrase);

                } else if (smethod.equals("delete")) {
                    lndContent = lndHttpClient.deleteRequestToLndPod(command, nodeAddress, data, lndNodeName, passphrase);
                } else {
                    lndContent = lndHttpClient.getRequestToLndPod(command, nodeAddress, data, lndNodeName, passphrase);
                }

                if (lndContent.getStatus() != 200){
                    throw new BadRequestException(400, "LND returned an unsuccessful response");
                }

// for now we don't need count number of request so i comment count function for Hive request
 //               httpClientToken.addOneToCount(token);
                commandHistoryService.saveCH(command, token);

                LndInteraction interaction = LndInteraction.builder().action(command).nodeName(lndname)
                        .request(data.isPresent() ? data.get().toString() : "Empty Request").response(
                                lndContent == null ? "Empty Response" : lndContent.getResponse()).build();
                lndInteractionService.logLndInteraction(interaction);

                return lndContent.getResponse();

            } else {
                throw new BadRequestException(400, String.format("Status of LND node %s is %s", lndNodeName, status));
            }

        } else {
            throw new BadRequestException(400, "Token expired or wrong");
        }
    }

    private boolean shouldProceedWithNonCustodialRequest(String path, String method, String passphrase) {

        return !(LndUtil.requiresAdminMacaroon(path, method) && StringUtils.isBlank(passphrase));

    }


}


