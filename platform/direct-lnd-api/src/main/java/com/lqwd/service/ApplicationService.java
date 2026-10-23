package com.lqwd.service;

import com.google.gson.Gson;
import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.ServerErrorException;
import com.lqwd.httpclient.HttpClientToken;
import com.lqwd.messaging.schemas.EmailAddress;
import com.lqwd.messaging.schemas.EmailBody;
import com.lqwd.messaging.schemas.RecipientType;
import com.lqwd.model.entities.Application;
import com.lqwd.model.entities.SignupConfirmationToken;
import com.lqwd.model.request.ApplicationRequest;
import com.lqwd.model.response.ApiResponse;
import com.lqwd.model.response.ApplicationResponse;
import com.lqwd.model.response.MainResponse;
import com.lqwd.model.response.PageResponse;
import com.lqwd.repository.ApplicationRepository;
import com.lqwd.repository.SignupConfirmationTokenRepository;
import lombok.RequiredArgsConstructor;
import net.bytebuddy.utility.RandomString;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.Arrays;

@Service
@RequiredArgsConstructor
public class ApplicationService {

    private final AppProperties appProperties;
    private final ApplicationRepository applicationRepository;
    private final KafkaMessageSender kafkaMessageSender;
    private final SignupConfirmationTokenRepository signupConfirmationTokenRepository;

    private final AccessTokenServiceHelper accessTokenServiceHelper;
    private final HttpClientToken httpClientToken;

    public Application save(Application application) {
        return applicationRepository.save(application);
    }

    public ApiResponse<?> apply(ApplicationRequest request) {
        String token = accessTokenServiceHelper.getClientAccessToken();
        MainResponse responseInfo = null;
        try {
            responseInfo = httpClientToken.createApplication(request, token);
        } catch (UnsupportedEncodingException e) {
            throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                    "Cannot apply at the moment. there seems to be a server issue.");
        }


        if (responseInfo.getStatus() != HttpStatus.OK.value()) {

            if (responseInfo.getError()== null) {
                throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                        "Cannot apply at the moment. there seems to be a server issue.");
            }
            throw new ServerErrorException(responseInfo.getStatus(),
                    responseInfo.getError());
        }
        Gson gson = new Gson();
        return new ApiResponse<>(gson.fromJson(responseInfo.getObject().toString(), ApplicationResponse.class), "Your request was successful, you will receive a response from us soon");
    }


    public ApiResponse<PageResponse<Application>> getApplications(int pageNo, int pageSize) {

        Page<Application> applications = applicationRepository.findAll(PageRequest.of(pageNo,pageSize,
                Sort.by("dateCreated").descending()));


        return new ApiResponse<>(new PageResponse<>(applications.getNumber(),applications.getSize(),
                applications.getTotalElements(),applications.getContent(), applications.getTotalPages()), "Request successful");
    }


    public ApiResponse<String> verifySignupToken(String emailAddress, String inviteCode) {
        String token = accessTokenServiceHelper.getClientAccessToken();
        MainResponse responseInfo = null;
        try {
            responseInfo = httpClientToken.verifyApplication(emailAddress,inviteCode , token);
        } catch (UnsupportedEncodingException e) {
            throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                    "Cannot verify invite code at the moment. there seems to be a server issue.");
        }
        if (responseInfo.getStatus() != HttpStatus.OK.value()) {

            if (responseInfo.getObject() == null) {
                throw new ServerErrorException(HttpStatus.INTERNAL_SERVER_ERROR.value(),
                        "Cannot verify invite code at the moment. there seems to be a server issue.");
            }
            throw new ServerErrorException(responseInfo.getStatus(),
                    responseInfo.getObject().toString());
        }
        return new ApiResponse<>("Verification successful", "Request successful");
    }


    private SignupConfirmationToken generateSignupToken(String emailAddress){

        SignupConfirmationToken signupConfirmationToken = new SignupConfirmationToken();
        signupConfirmationToken.setEmail(emailAddress);
        signupConfirmationToken.setInviteCode(RandomString.make(24));

        return signupConfirmationTokenRepository.save(signupConfirmationToken);

    }

    private void sendEmailForApplication(Application application, String signupLink) {

        String message = String.format("<H2>New Application</H2><br><br><p>There's a new application from %s " +
                        "see details below</p><br>" +
                        "<ul>" +
                        "<li>Contact Name: %s</li>"+
                        "<li>Contact Email: %s</li>"+
                        "<li>Address: %s</li>"+
                        "<li>Zip code: %s</li>"+
                        "<li>Country code: %s</li>"+
                        "</ul><br><br><H3>Use the registration link to signup %s</H3>",
                application.getCompanyName(),
                application.getContactName(),application.getContactEmail(),
                application.getCompanyAddress(),application.getZipCode(),
                application.getCountryCode(),signupLink
                );

        EmailBody emailBody = new EmailBody();
        emailBody.setBody(message);
        emailBody.setSubject("New Company Application");
        emailBody.setAttachments(new ArrayList<>());

        EmailAddress sender = new EmailAddress();
        sender.setDisplayName("Info");
        sender.setEmail("info@lqwd.money");
        sender.setRecipientType(RecipientType.TO);

        EmailAddress receiver = new EmailAddress();
        receiver.setDisplayName(appProperties.getApplication_notification_to());
        receiver.setEmail(appProperties.getApplication_notification_to());
        receiver.setRecipientType(RecipientType.TO);

        emailBody.setRecipients(Arrays.asList(receiver));
        emailBody.setSender(sender);

        kafkaMessageSender.sendEmail(emailBody);

    }

}
