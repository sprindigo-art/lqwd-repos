package com.lqwd.security.oauth2.controller.admin;

import com.lqwd.security.oauth2.dto.MServiceDTO;
import com.lqwd.security.oauth2.model.security.Mservice;
import com.lqwd.security.oauth2.model.security.OauthClientDetails;
import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.repository.RoleRepository;
import com.lqwd.security.oauth2.service.MserviceService;
import com.lqwd.security.oauth2.service.OauthClientDetailsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

import javax.validation.Valid;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Controller
public class MserviceController {

    @Autowired
    private MserviceService mserviceService;

    @Autowired
    private OauthClientDetailsService oauthClientDetailsService;
    
    @Autowired
    private RoleRepository roleRepository;

    @RequestMapping(value="/backend/mservices", method = RequestMethod.GET)
    public String grades(Model model, @RequestParam("page") Optional<Integer> pageNumber,
                         @RequestParam("size") Optional<Integer> pageSize){

        int currentPage = pageNumber.orElse(1);
        int size = pageSize.orElse(50);


        //Page<Grade> page = gradeService.getPage(currentPage-1, size);
        Page<Mservice> page = mserviceService.getAllNonDeleted(currentPage-1, size);

        model.addAttribute("page", page);

        int totalPages = page.getTotalPages();
        if (totalPages > 0) {
            List<Integer> pageNumbers = IntStream.rangeClosed(1, totalPages)
                    .boxed()
                    .collect(Collectors.toList());
            model.addAttribute("pageNumbers", pageNumbers);
        }

        return "backend/mservices";
    }

    @RequestMapping(value="/backend/edit/mservice", method = RequestMethod.GET)
    public String newMservice(Model model, @RequestParam("id") Optional<String> id){

    	MServiceDTO mservice = mserviceService.getMserviceDTO(UUID.fromString(id.get()));

        model.addAttribute("mservice", mservice);
        List<OauthClientDetails> oauthClientDetails = oauthClientDetailsService.getAllNonDeleted();

        model.addAttribute("oauthclients", oauthClientDetails);

        return "backend/addmservice";
    }

    @RequestMapping(value="/backend/add/mservice", method = RequestMethod.GET)
    public String newMservice(Model model){

    	MServiceDTO mservice = new MServiceDTO();
        model.addAttribute("mservice", mservice);

        List<OauthClientDetails> oauthClientDetails = oauthClientDetailsService.getAllNonDeleted();

        model.addAttribute("oauthclients", oauthClientDetails);
        

        return "backend/addmservice";
    }

    @RequestMapping(value = "/backend/add/mservice", method = RequestMethod.POST)
    public String createNewMservice(@Valid MServiceDTO mservice, BindingResult bindingResult) {
        if (bindingResult.hasErrors()) {
            return "backend/addmservice";
        } else {
            mserviceService.saveMserviceFromDTO(mservice);
        }
        return "redirect:/backend/mservices";
    }

    @RequestMapping(value="/backend/delete/mservice", method = RequestMethod.GET)
    public String deleteMservice(Model model,@RequestParam("id") Optional<String> id){
        Mservice mservice = mserviceService.findMservice(UUID.fromString(id.get()));
        mservice.setStatus("DELETED");
        mserviceService.saveMservice(mservice);
        return "redirect:/backend/mservices";
    }
}
