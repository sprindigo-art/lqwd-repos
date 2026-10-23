//package com.lqwd.controller;
//
//import com.lqwd.model.response.ApiResponse;
//import com.lqwd.service.TwilioVerificationService;
//import com.twilio.rest.verify.v2.service.Verification;
//import lombok.RequiredArgsConstructor;
//import org.springframework.web.bind.annotation.PostMapping;
//import org.springframework.web.bind.annotation.RequestMapping;
//import org.springframework.web.bind.annotation.RequestParam;
//import org.springframework.web.bind.annotation.RestController;
//
//@RestController
//@RequiredArgsConstructor
//@RequestMapping("/api")
//public class VerificationController {
//
//
//    private final TwilioVerificationService verificationService;
//
//
//    @PostMapping("/v1/verification/send_phone_number_otp")
//    public ApiResponse<String> initiatePhoneVerification(
//                             @RequestParam String phoneNumber, @RequestParam Verification.Channel channel) {
//
//        return verificationService.startVerification(phoneNumber,channel.toString());
//
//    }
//
//    @PostMapping("/v1/verification/verify_phone_number_otp")
//    public ApiResponse<String> verifyPhoneNumber(
//            @RequestParam String phoneNumber, @RequestParam String code) {
//
//
//        return verificationService.checkVerification(phoneNumber,code);
//
//    }
//
//}
