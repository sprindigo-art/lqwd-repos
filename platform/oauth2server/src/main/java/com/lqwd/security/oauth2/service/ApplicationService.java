package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.config.ApiException;
import com.lqwd.security.oauth2.dto.UserDTO;
import com.lqwd.security.oauth2.model.request.ApplicationRequest;
import com.lqwd.security.oauth2.model.security.Application;
import com.lqwd.security.oauth2.model.security.Mservice;
import com.lqwd.security.oauth2.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Timestamp;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import net.bytebuddy.utility.RandomString;
@Service
@RequiredArgsConstructor
public class ApplicationService {


    private final ApplicationRepository applicationRepository;

    private final MailService mailService;

    @Value("${app.frontend_base_url}")
    private String frontendUrl;

    public Page<Application> getAll(int currentPage, int size){
        Pageable pageable = PageRequest.of(currentPage, size);
        Page<Application> items  = applicationRepository.getAll(pageable);
        return items;
    }

    public Application find(Long id) {
        Optional<Application> applicationOption = applicationRepository.findById(id);
        if(applicationOption.isPresent()){
            return applicationOption.get();
        }
        return null;
    }

    public Application save(Application application) {
        return applicationRepository.save(application);
    }


    public void acceptApplication(Long id) throws Exception {
        Application application = applicationRepository.findById(id).orElseThrow(
                () ->  new Exception("Application Not found")
        );
        application.setStatus(Application.ApplicationStatus.ACCEPTED.name());
        save(application);
        String link = frontendUrl+"/beta-signup?invite="+application.getInviteCode();
        mailService.sendAcceptEmailForApplication(application,link,application.getContactEmail());
    }

    public void rejectApplication(Long id) throws Exception {
        Application application = applicationRepository.findById(id).orElseThrow(
                () ->  new Exception("Application Not found")
        );

        application.setStatus(Application.ApplicationStatus.REJECTED.name());
        save(application);
        String link = frontendUrl+"/beta-signup?invite="+application.getInviteCode();
        mailService.sendRejectEmailForApplication(application,link,application.getContactEmail());
    }

    public Application apply(ApplicationRequest request) throws ApiException {

        if(applicationRepository.existsByContactEmail(request.getContactEmail()))
            throw new ApiException(400,
                    "Oops! the contact email specified already exist, please try a different email");


        Application application = Application.builder().productInfo(request.getProductInfo()).goal(request.getGoal())
                .currentSolution(request.getCurrentSolution()).companyName(request.getCompanyName())
                .contactName(request.getContactName()).contactEmail(request.getContactEmail()).
                contactPhone(request.getContactPhone()).companyAddress(request.getCompanyAddress())
                .countryCode(request.getCountryCode()).zipCode(request.getZipCode()).companyUrl(request.getCompanyUrl())
                .inviteCode(RandomString.make(24))
                .status(Application.ApplicationStatus.NEW.name())
                .hasKyc(request.isHasKyc()).build();

        application = save(application);
        String link = frontendUrl+"/beta-signup?invite="+application.getInviteCode();
        mailService.sendAdminEmailForApplication(application,link);
        return application;
 }


    public String verifySignupToken(String emailAddress, String inviteCode) throws ApiException {

        Application application = applicationRepository.findByContactEmail(emailAddress).orElseThrow(
                () ->  new ApiException(404, "Email not approved")
        );

        if(!inviteCode.equalsIgnoreCase(application.getInviteCode()))
            throw new ApiException(400, "Invalid invite code provided, please try again");

        application.setUsageDate(new Date());
        save(application);
        return "Verification successful";
    }



}
