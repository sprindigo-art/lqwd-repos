package com.lqwd.controller;

import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.httpclient.LndHttpClient;

import com.lqwd.model.response.MainResponse;
;
import com.lqwd.service.CommandHistoryService;
import com.lqwd.service.LndAccessUserService;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;

import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Optional;


@RestController
@RequestMapping(value = "/lnd")
public class LndController {

    public static final Logger logger = LoggerFactory.getLogger(LndController.class);

    @Autowired
    LndHttpClient lndHttpClient ;

    @Autowired
    HttpClientToken httpClientToken;

    @Autowired
    LndAccessUserService lndAccessUserService;

    @Autowired
    CommandHistoryService commandHistoryService;

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}/{p4}", "/v2/{p1}/{p2}/{p3}/{p4}"}, method=RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage4(@RequestHeader("apikey") String apikey,
                                @RequestHeader("lnd_name") String lndname,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @PathVariable(required = false) Optional<String> p3,
                                @PathVariable(required = false) Optional<String> p4,
                                @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }
            if(p1.isPresent() && p2.isPresent() && p3.isPresent() && p4.isPresent() ) {
                String command="v1/" + p1.get() +"/" + p2.get() +"/" + p3.get() +"/" + p4.get();
                lndContent = runLndHttpClinet("post", command, apikey, lndname, values);
            }
            return lndContent;

        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}/{p4}", "/v2/{p1}/{p2}/{p3}/{p4}"}, method=RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage4(@RequestHeader("apikey") String apikey,
                               @RequestHeader("lnd_name") String lndname,
                               @PathVariable(required = false) Optional<String> p1,
                               @PathVariable(required = false) Optional<String> p2,
                               @PathVariable(required = false) Optional<String> p3,
                               @PathVariable(required = false) Optional<String> p4,
                               @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }
            if(p1.isPresent() && p2.isPresent() && p3.isPresent() && p4.isPresent() ) {
                String command="v1/" + p1.get() +"/" + p2.get() +"/" + p3.get() +"/" + p4.get();
                lndContent = runLndHttpClinet("get", command, apikey, lndname, values);
            }
            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}/{p4}", "/v2/{p1}/{p2}/{p3}/{p4}"}, method=RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage4(@RequestHeader("apikey") String apikey,
                                @RequestHeader("lnd_name") String lndname,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @PathVariable(required = false) Optional<String> p3,
                                @PathVariable(required = false) Optional<String> p4,
                                @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }
            if(p1.isPresent() && p2.isPresent() && p3.isPresent() && p4.isPresent() ) {
                String command="v1/" + p1.get() +"/" + p2.get() +"/" + p3.get() +"/" + p4.get();
                lndContent = runLndHttpClinet("delete", command, apikey, lndname, values);
            }
            return lndContent;

        } else {
            return "Apikey is null";
        }
    }



    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}", "/v2/{p1}/{p2}/{p3}"}, method=RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage3(@RequestHeader("apikey") String apikey,
                                @RequestHeader("lnd_name") String lndname,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @PathVariable(required = false) Optional<String> p3,
                                @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent() && p2.isPresent() && p3.isPresent()) {
                String command="v1/" + p1.get()+"/" + p2.get()+"/" + p3.get();
                lndContent = runLndHttpClinet("post",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}", "/v2/{p1}/{p2}/{p3}"}, method=RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage3(@RequestHeader("apikey") String apikey,
                               @RequestHeader("lnd_name") String lndname,
                               @PathVariable(required = false) Optional<String> p1,
                               @PathVariable(required = false) Optional<String> p2,
                               @PathVariable(required = false) Optional<String> p3,
                               @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent() && p2.isPresent() && p3.isPresent()) {
                String command="v1/" + p1.get()+"/" + p2.get()+"/" + p3.get();
                lndContent = runLndHttpClinet("get",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }

    }

    @RequestMapping(value = {"/v1/{p1}/{p2}/{p3}", "/v2/{p1}/{p2}/{p3}"}, method=RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage3(@RequestHeader("apikey") String apikey,
                                @RequestHeader("lnd_name") String lndname,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @PathVariable(required = false) Optional<String> p3,
                                @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent() && p2.isPresent() && p3.isPresent()) {
                String command="v1/" + p1.get()+"/" + p2.get()+"/" + p3.get();
                lndContent = runLndHttpClinet("delete",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}/{p2}", "/v2/{p1}/{p2}"}, method=RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage2(@RequestHeader("apikey") String apikey,
                                @RequestHeader("lnd_name") String lndname,
                                HttpServletRequest request,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent() && p2.isPresent() ) {
                String spath = request.getRequestURL().toString();
                String firstPath = "v1/";
                if(spath.contains("/lnd/v2")){
                    firstPath = "v2/";
                }
                String command=firstPath + p1.get() +"/"+ p2.get() ;
                lndContent = runLndHttpClinet("post",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}/{p2}", "/v2/{p1}/{p2}"}, method=RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage2(@RequestHeader("apikey") String apikey,
                               @RequestHeader("lnd_name") String lndname,
                               HttpServletRequest request,
                               @PathVariable(required = false) Optional<String> p1,
                               @PathVariable(required = false) Optional<String> p2,
                               @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent() && p2.isPresent() ) {
                String spath = request.getRequestURL().toString();
                String firstPath = "v1/";
                if(spath.contains("/lnd/v2")){
                    firstPath = "v2/";
                }
                String command=firstPath + p1.get() +"/"+ p2.get() ;
                lndContent = runLndHttpClinet("get",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}/{p2}", "/v2/{p1}/{p2}"}, method=RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage2(@RequestHeader("apikey") String apikey,
                                @RequestHeader("lnd_name") String lndname,
                                HttpServletRequest request,
                                @PathVariable(required = false) Optional<String> p1,
                                @PathVariable(required = false) Optional<String> p2,
                                @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent() && p2.isPresent() ) {
                String spath = request.getRequestURL().toString();
                String firstPath = "v1/";
                if(spath.contains("/lnd/v2")){
                    firstPath = "v2/";
                }
                String command=firstPath + p1.get() +"/"+ p2.get() ;
                lndContent = runLndHttpClinet("delete",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}", "/v2/{p1}"}, method=RequestMethod.POST, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String postTmessage(@RequestHeader("apikey") String apikey,
                               @RequestHeader("lnd_name") String lndname,
                               @PathVariable(required = false) Optional<String> p1,
                               @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

       //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
                Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

                if(p1.isPresent()) {
                    String command="v1/" + p1.get();
                    lndContent = runLndHttpClinet("post",command, apikey, lndname, values);
                }

                return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}", "/v2/{p1}"}, method=RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String getTmessage(@RequestHeader("apikey") String apikey,
                              @RequestHeader("lnd_name") String lndname,
                              @PathVariable(required = false) Optional<String> p1,
                              @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent()) {
                String command="v1/" + p1.get();
                lndContent = runLndHttpClinet("get",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    @RequestMapping(value = {"/v1/{p1}", "/v2/{p1}"}, method=RequestMethod.DELETE, produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    public String deleteTmessage(@RequestHeader("apikey") String apikey,
                               @RequestHeader("lnd_name") String lndname,
                               @PathVariable(required = false) Optional<String> p1,
                               @RequestBody Optional<MultiValueMap<String, String>> values) throws Exception {

        String lndContent="{\"error\":\"Command not exist\"}";
        if(apikey != null){

            //     Boolean checkCountAccess = lndAccessUserService.checkAndUpdate(apikey);
            Boolean checkCountAccess = true;
            if (!checkCountAccess) {
                return " You are rich your number of request. Please try again later!";
            }

            if(p1.isPresent()) {
                String command="v1/" + p1.get();
                lndContent = runLndHttpClinet("delete",command, apikey, lndname, values);
            }

            return lndContent;


        } else {
            return "Apikey is null";
        }
    }

    private String runLndHttpClinet(String smethod, String command, String apikey, String lndname, Optional<MultiValueMap<String, String>> values) throws Exception {

        MainResponse mainResponse;

        if(isToken(apikey)){
            mainResponse = httpClientToken.checkToken(apikey, lndname);
            if (mainResponse != null && mainResponse.getStatus() == 200) {
                JSONObject jsonData = new JSONObject(mainResponse.getObject());
                System.out.println(jsonData);
                String status = (String) jsonData.get("status");

                if (status.equals("active")) {
                    String lndContent;
                    if (smethod.equals("post")) {
                        lndContent = lndHttpClient.postRequestToLndPod(command, values, jsonData);
                    } else if (smethod.equals("delete")) {
                        lndContent = lndHttpClient.deleteRequestToLndPod(command, values, jsonData);
                    } else {
                        String lndnodename = (String) jsonData.get("lndNodeName");
                        String namespace = (String) jsonData.get("namespace");
                        lndContent = lndHttpClient.getRequestToLndPod(command,  lndnodename, namespace);
                    }
                    httpClientToken.addOneToCount(apikey);
                    commandHistoryService.saveCH(command, apikey);
                    return lndContent;
                } else {
                    String lndNodeName = (String) jsonData.get("lndNodeName");
                    return "{\"error\":\"Status of LND node "+lndNodeName+" is "+ status +" \"}";
                }

            } else {
                return "{\"error\":\" Token expired or wrong \"}";
            }
        } else {
            mainResponse = httpClientToken.checkApikey(apikey, lndname);

            if (mainResponse != null && mainResponse.getStatus() == 200) {
                JSONObject jsonData = new JSONObject(mainResponse.getObject());
                String status = (String) jsonData.get("status");
                String accountstatus = (String) jsonData.get("accountstatus");
                String accountplan = (String) jsonData.get("accountplan");

                if (status.equals("active")) {
                    if (accountplan.equals("free") && accountstatus.equals("active")) {
                        String lndContent;
                        if (smethod.equals("post")) {
                            lndContent = lndHttpClient.postRequestToLndPod(command, values, jsonData);
                        } else {
                            String lndnodename = (String) jsonData.get("lndNodeName");
                            String namespace = (String) jsonData.get("namespace");
                            lndContent = lndHttpClient.getRequestToLndPod(command,  lndnodename, namespace);
                        }
                        httpClientToken.addOneToCount(apikey);
                        commandHistoryService.saveCH(command, apikey);
                        return lndContent;
                    }
                } else {
                    String lndNodeName = (String) jsonData.get("lndNodeName");
                    return "{\"error\":\"Status of LND node "+lndNodeName+" is "+ status +" \"}";
                }
            } else {
                return "{\"error\":\" Apikey expired or wrong \"}";
            }

        }
        return "{\"error\":\"Command not exist or wrong parameters\"}";
    }

    private boolean isToken(String apikey){
        String[] sarray=apikey.split("-");
        if(sarray.length == 5){
            if(sarray[1].length() == 4 && sarray[2].length() == 4){
                return true;
            }
        }
        return false;
    }
}
