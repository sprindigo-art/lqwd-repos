package com.lqwd.security.oauth2.controller.admin;

import com.lqwd.security.oauth2.config.ApiException;
import com.lqwd.security.oauth2.config.utils.ApplicationUtils;
import com.lqwd.security.oauth2.dto.MServiceDTO;
import com.lqwd.security.oauth2.dto.UserDTO;
import com.lqwd.security.oauth2.model.request.ApplicationRequest;
import com.lqwd.security.oauth2.model.request.VerifySignupTokenRequest;
import com.lqwd.security.oauth2.model.response.ErrorResponse;
import com.lqwd.security.oauth2.model.security.*;
import com.lqwd.security.oauth2.service.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import javax.crypto.BadPaddingException;
import javax.crypto.IllegalBlockSizeException;
import javax.validation.Valid;
import java.io.UnsupportedEncodingException;
import java.security.InvalidKeyException;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Controller
public class ApplicationController {

    @Autowired
    private ApplicationService applicationService;

    @Autowired
    private MailService mailService;

    @RequestMapping(value="/backend/applications", method = RequestMethod.GET)
    public String applications(Model model, @RequestParam("page") Optional<Integer> pageNumber,
                         @RequestParam("size") Optional<Integer> pageSize){

        int currentPage = pageNumber.orElse(1);
        int size = pageSize.orElse(50);

        Page<Application> page = applicationService.getAll(currentPage-1, size);

        model.addAttribute("page", page);

        int totalPages = page.getTotalPages();
        if (totalPages > 0) {
            List<Integer> pageNumbers = IntStream.rangeClosed(1, totalPages)
                    .boxed()
                    .collect(Collectors.toList());
            model.addAttribute("pageNumbers", pageNumbers);
        }
        return "backend/applications";
    }


    @RequestMapping(value="/backend/applications/edit", method = RequestMethod.GET)
    public String viewApplication(Model model,  @RequestParam("id") Long id){
        Application application = applicationService.find(id);
        System.out.println(application.getProductInfo());
        model.addAttribute("app", application);
        return "backend/editapplication";
    }


    @RequestMapping(value="/backend/applications/accept", method = RequestMethod.GET)
    public String acceptApplication(Model model, @RequestParam("id") Long id, RedirectAttributes redirectAttributes){
        try {
            applicationService.acceptApplication(id);
            redirectAttributes.addAttribute("message","Application accepted successfully");
            return "redirect:/backend/applications/edit?id="+id;
        }catch (Exception e){
            redirectAttributes.addAttribute("message",e.getMessage());
            return "redirect:/backend/applications";
        }
    }

    @RequestMapping(value="/backend/applications/reject", method = RequestMethod.GET)
    public String rejectApplication(Model model, @RequestParam("id") Long id, RedirectAttributes redirectAttributes){
        try {
            applicationService.rejectApplication(id);
            redirectAttributes.addAttribute("message","Application rejected successfully");
            return "redirect:/backend/applications/edit?id="+id;
        }catch (Exception e){
            redirectAttributes.addAttribute("message",e.getMessage());
            return "redirect:/backend/applications";
        }
    }

    @PostMapping("/application/create")
    public ResponseEntity<?> create(@RequestBody @Valid ApplicationRequest request) {
        try {
            return ResponseEntity.ok(applicationService.apply(request));
        } catch (ApiException e) {
            return ResponseEntity.status(e.getStatus()).body(e.getMessage());
        }
    }

    @PostMapping("/application/verify_token")
    public  ResponseEntity<?> verify(@RequestBody @Valid VerifySignupTokenRequest request) {
        try {
            return ResponseEntity.ok(applicationService.verifySignupToken(request.getEmailAddress(),
                    request.getInviteCode()));
        } catch (ApiException e) {
            return ResponseEntity.status(e.getStatus()).body(e.getMessage());
        }
    }

}
