package com.lqwd.security.oauth2.controller.admin;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.lqwd.security.oauth2.config.utils.ApplicationUtils;
import com.lqwd.security.oauth2.dto.RoleDTO;
import com.lqwd.security.oauth2.dto.StakingDTO;
import com.lqwd.security.oauth2.dto.UserDTO;
import com.lqwd.security.oauth2.model.LndPort;
import com.lqwd.security.oauth2.model.LndPortRequest;
import com.lqwd.security.oauth2.model.response.DlaResponse;
import com.lqwd.security.oauth2.model.security.User_;
import com.lqwd.security.oauth2.service.LNDPortService;
import com.lqwd.security.oauth2.service.StakingService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

import javax.validation.Valid;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Controller
@RequiredArgsConstructor
public class LNDPortController {


    private final LNDPortService lndPortService;
    JsonParser parser = new JsonParser();


    @GetMapping("/backend/ports")
    public String grades(Model model, @RequestParam(defaultValue = "0",value = "pageNumber") int pageNumber,
                         @RequestParam(defaultValue = "10", value = "pageSize") int pageSize) throws Exception {

        Page<LndPort> ports = lndPortService.findAll(pageNumber,pageSize);


        model.addAttribute("pageNo", pageNumber);
        model.addAttribute("pageSize", pageSize);
        model.addAttribute("total", ports.getTotalElements());
        model.addAttribute("pages", ports.getTotalPages());
        model.addAttribute("content", ports.getContent());

        return "backend/portlist";
    }


    @RequestMapping(value="/backend/add/port", method = RequestMethod.GET)
    public String newPort(Model model){
        model.addAttribute("port", new LndPortRequest());
        return "backend/addport";
    }

    @RequestMapping(value = "/backend/add/port", method = RequestMethod.POST)
    public String createNewGrade(@Valid LndPortRequest request, BindingResult bindingResult) {

        if (bindingResult.hasErrors()) {

            return "backend/add/port";

        } else {

            if(request.getPortRange().contains("-")){
               String[] ports =  request.getPortRange().split("-");
               int start = Integer.parseInt(ports[0]);
               int end = Integer.parseInt(ports[1]);

               lndPortService.saveFromRange(start, end, request.getBtcHost(), request.getLndIp());

            }else{

                lndPortService.save(Integer.parseInt(request.getPortRange()), request.getBtcHost(), request.getLndIp());

            }
        }
        return "redirect:/backend/ports";
    }

    @RequestMapping(value="/backend/ports/delete", method = RequestMethod.GET)
    public String deletePort(Model model, @RequestParam("id") Long id){

        boolean deleted = lndPortService.deleteById(id);

        if(!deleted){
            model.addAttribute("message", "Only ports which are not in use can be deleted");
        }

        return "redirect:/backend/ports";
    }

}
