//package com.lqwd.service;
//
//import com.lqwd.interfaces.VerificationService;
//import com.lqwd.model.response.ApiResponse;
//import com.twilio.exception.ApiException;
//import com.twilio.rest.verify.v2.service.Verification;
//import com.twilio.rest.verify.v2.service.VerificationCheck;
//import org.springframework.beans.factory.annotation.Value;
//import org.springframework.cloud.context.config.annotation.RefreshScope;
//import org.springframework.stereotype.Service;
//
//@Service
//@RefreshScope
//public class TwilioVerificationService implements VerificationService {
//
//
//    @Value("${twilio.verify.service-sid}")
//    private String twilioVerificationSID;
//
//
//    public ApiResponse<String> startVerification(String phone, String channel) {
//        try {
//            Verification verification = Verification.creator(twilioVerificationSID, phone, channel).create();
//            return new ApiResponse<>(200, verification.getSid(), "Request successful");
//        } catch (ApiException exception) {
//            return new ApiResponse<>(400, exception.getMessage(), exception.getMessage());
//        }
//    }
//
//    public ApiResponse<String> checkVerification(String phone, String code) {
//        try {
//            VerificationCheck verification = VerificationCheck.creator(twilioVerificationSID, code).setTo(phone).create();
//            if (!"approved".equals(verification.getStatus()))
//                return new ApiResponse(400, "Invalid code","Invalid code");
//
//            return new ApiResponse<>(200, verification.getSid(), "Verification successful");
//
//        } catch (ApiException exception) {
//            return new ApiResponse(400, exception.getMessage(),"Something went wrong please try again later");
//        }
//    }
//}