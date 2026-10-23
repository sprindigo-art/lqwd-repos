package com.lqwd.security.oauth2.controller.admin;

import com.lqwd.security.oauth2.config.utils.ApplicationUtils;
import com.lqwd.security.oauth2.dto.RoleDTO;
import com.lqwd.security.oauth2.model.security.Mservice;
import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.service.MserviceService;
import com.lqwd.security.oauth2.service.RoleService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

import javax.validation.Valid;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Controller
public class RoleController {

    @Autowired
    private RoleService roleService;

    @Autowired
    private MserviceService mserviceService;

    @RequestMapping(value="/backend/roles", method = RequestMethod.GET)
    public String roles(Model model, @RequestParam("page") Optional<Integer> pageNumber,
                         @RequestParam("size") Optional<Integer> pageSize){

        int currentPage = pageNumber.orElse(1);
        int size = pageSize.orElse(50);


        //Page<Grade> page = gradeService.getPage(currentPage-1, size);
        Page<Role_> page = roleService.getAllNonDeleted(currentPage-1, size);

        model.addAttribute("page", page);

        int totalPages = page.getTotalPages();
        if (totalPages > 0) {
            List<Integer> pageNumbers = IntStream.rangeClosed(1, totalPages)
                    .boxed()
                    .collect(Collectors.toList());
            model.addAttribute("pageNumbers", pageNumbers);
        }

        return "backend/roles";
    }



    @RequestMapping(value="/backend/edit/role", method = RequestMethod.GET)
    public String editRole(Model model, @RequestParam("id") Optional<String> id){

    	RoleDTO role_ = roleService.getRoleDTO(id.get());

        model.addAttribute("role", role_);

        List<Mservice> mservices = mserviceService.findAllMservices();

        model.addAttribute("mservices",mservices);
        model.addAttribute("roleNames", roleService.getRoleLabels());
        return "backend/addrole";
    }

    @RequestMapping(value="/backend/add/role", method = RequestMethod.GET)
    public String newGrade(Model model){
    	List<Mservice> mservices = mserviceService.findAllMservices();
    	model.addAttribute("mservices",mservices);
    	
    	
    	RoleDTO role_ = new RoleDTO();
    	if(mservices.size() > 0) {
    		role_.setMserviceId(mservices.get(0).getId().toString());
    	}
        model.addAttribute("role", role_);
        model.addAttribute("roleNames", roleService.getRoleLabels());
        return "backend/addrole";
    }

    @RequestMapping(value = "/backend/add/role", method = RequestMethod.POST)
    public String createNewGrade(@Valid RoleDTO roleDTO, BindingResult bindingResult) {

        if (bindingResult.hasErrors()) {
            return "backend/addrole";
        } else {
            if(roleDTO.getStatus() == null) {
            	roleDTO.setStatus("active");
            }
            roleService.saveRole_FromDTO(roleDTO);
        }
        return "redirect:/backend/roles";
    }

    @RequestMapping(value="/backend/delete/role", method = RequestMethod.GET)
    public String deleteLocation(Model model,@RequestParam("id") Optional<String> roleid){
        Role_ role = roleService.findRole(roleid.get());
        role.setStatus("DELETED");
        roleService.saveRole(role);
        return "redirect:/backend/roles";
    }

}
