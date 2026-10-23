package com.lqwd.interfaces;


import com.lqwd.model.response.ApiResponse;

public interface VerificationService {

    ApiResponse startVerification(String phoneNumber, String channel);

    ApiResponse checkVerification(String phoneNumber, String code);
}