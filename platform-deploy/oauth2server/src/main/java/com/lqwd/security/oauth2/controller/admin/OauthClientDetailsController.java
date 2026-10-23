package com.lqwd.security.oauth2.controller.admin;

import com.lqwd.security.oauth2.config.encryption.Encoders;
import com.lqwd.security.oauth2.dto.OauthClientDTO;
import com.lqwd.security.oauth2.model.security.OauthClientDetails;
import com.lqwd.security.oauth2.service.OauthClientDetailsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.domain.Page;
import org.springframework.expression.spel.ast.NullLiteral;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

import javax.validation.Valid;
import javax.validation.constraints.Null;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Controller
public class OauthClientDetailsController {


    @Autowired
    private Encoders encoders;

    @Autowired
    private OauthClientDetailsService oauthClientDetailsService;
    
    

    @RequestMapping(value="/backend/oauthclients", method = RequestMethod.GET)
    public String grades(Model model, @RequestParam("page") Optional<Integer> pageNumber,
                         @RequestParam("size") Optional<Integer> pageSize){

        int currentPage = pageNumber.orElse(1);
        int size = pageSize.orElse(50);


        //Page<Grade> page = gradeService.getPage(currentPage-1, size);
        Page<OauthClientDetails> page = oauthClientDetailsService.getAllNonDeleted(currentPage-1, size);

        model.addAttribute("page", page);

        int totalPages = page.getTotalPages();
        if (totalPages > 0) {
            List<Integer> pageNumbers = IntStream.rangeClosed(1, totalPages)
                    .boxed()
                    .collect(Collectors.toList());
            model.addAttribute("pageNumbers", pageNumbers);
        }

        return "backend/oauthclients";
    }



    @RequestMapping(value="/backend/edit/oauthclient", method = RequestMethod.GET)
    public String newGrade(Model model, @RequestParam("clientid") Optional<String> clientid){

    	OauthClientDTO oauthClientDetails = oauthClientDetailsService.getOauthClientDTO(clientid.get());

        model.addAttribute("oauthclient", oauthClientDetails);

        return "backend/addoauthclient";
    }

    @RequestMapping(value="/backend/add/oauthclient", method = RequestMethod.GET)
    public String newGrade(Model model){

    	OauthClientDTO oauthClientDetails = new OauthClientDTO();
        model.addAttribute("oauthclient", oauthClientDetails);

        return "backend/addoauthclient";
    }

    @RequestMapping(value = "/backend/add/oauthclient", method = RequestMethod.POST)
    public String createNewOauthclient(@Valid OauthClientDTO OauthDTO, BindingResult bindingResult, Model model) {

        if (bindingResult.hasErrors()) {
            List<String> errorMessages = bindingResult.getAllErrors().stream().map((error) -> error.getDefaultMessage()).collect(Collectors.toList());
            for(String mes : errorMessages){
                System.out.println(mes);
            }
            model.addAttribute("oauthclient", OauthDTO);
            return "backend/addoauthclient";
        } else {

            if(OauthDTO.getAdditionalInformation() == null || OauthDTO.getAdditionalInformation().length() <1 ){
            	OauthDTO.setAdditionalInformation(null);
            }
            if(OauthDTO.getAutoapprove() == null || OauthDTO.getAutoapprove().length() <1 ){
            	OauthDTO.setAutoapprove(null);
            }
            if(OauthDTO.getClientSecret() != null ){
                OauthDTO.setClientSecret(encoders.oauthClientPasswordEncoder().encode(OauthDTO.getClientSecret()));
            }

            oauthClientDetailsService.saveOauthClientFromDTO(OauthDTO);
        }
        return "redirect:/backend/oauthclients";
    }

    @RequestMapping(value="/backend/delete/oauthclient", method = RequestMethod.GET)
    public String deleteOauthclient(Model model,@RequestParam("clientid") Optional<String> clientid){
        OauthClientDetails oauthClientDetails = oauthClientDetailsService.findOauthClient(clientid.get());
        oauthClientDetails.setAdditionalInformation("DELETED");
        oauthClientDetailsService.saveOauthClient(oauthClientDetails);
        return "redirect:/backend/oauthclients";
    }
}
