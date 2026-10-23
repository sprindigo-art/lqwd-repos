package com.lqwd.controller;

import com.lqwd.model.entities.Application;
import com.lqwd.model.request.ApplicationRequest;
import com.lqwd.model.request.VerifySignupTokenRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.service.ApplicationService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api")
public class ApplicationController {

    private final ApplicationService applicationService;


    @PostMapping("/v1/application/apply")
    public ApiResponse<?> apply(@RequestBody @Valid ApplicationRequest request) {
        return applicationService.apply(request);
    }

    @PostMapping("/v1/application/verify_token")
    public ApiResponse<String> verify(@RequestBody @Valid VerifySignupTokenRequest request) {

        return applicationService.verifySignupToken(request.getEmailAddress(),
                request.getInviteCode());

    }

    @GetMapping("/v1/applications")
    public ApiResponse<PageResponse<Application>> getApplications(@RequestParam(defaultValue = "0") int pageNumber,
                                                                  @RequestParam(defaultValue = "10") int pageSize )  {

        return applicationService.getApplications(pageNumber,pageSize);

    }

}
