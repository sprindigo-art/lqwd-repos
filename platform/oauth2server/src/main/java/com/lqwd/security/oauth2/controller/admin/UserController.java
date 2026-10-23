package com.lqwd.security.oauth2.controller.admin;

import com.lqwd.security.oauth2.config.utils.ApplicationUtils;
import com.lqwd.security.oauth2.dto.UserDTO;
import com.lqwd.security.oauth2.model.response.ErrorResponse;
import com.lqwd.security.oauth2.model.security.*;
import com.lqwd.security.oauth2.service.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.security.oauth2.provider.token.TokenStore;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.validation.BindingResult;
import org.springframework.validation.ObjectError;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;

import javax.crypto.BadPaddingException;
import javax.crypto.IllegalBlockSizeException;
import javax.validation.Valid;
import java.io.UnsupportedEncodingException;
import java.security.InvalidKeyException;
import java.util.*;
import java.util.stream.Collector;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Controller
public class UserController {

    @Autowired
    private UserService userService;

    @Autowired
    private User_DetailsService user_detailsService;

    @Autowired
    private AccountTypeService accountTypeService;
    
    @Autowired
    private ApiKeyService apiKeyService;
    
    @Autowired
    private RoleService roleService;

    @Autowired
    private LndNodeInfoService lndNodeInfoService;



    @RequestMapping(value="/backend/users", method = RequestMethod.GET)
    public String grades(Model model, @RequestParam("query") Optional<String> query, @RequestParam("page") Optional<Integer> pageNumber,
                         @RequestParam("size") Optional<Integer> pageSize){

        int currentPage = pageNumber.orElse(1);
        int size = pageSize.orElse(150);

        HashMap<String, Object> result = userService.getAllWithLndNodeAndApiKeyCount(currentPage-1, size, query.orElse(null));
        model.addAttribute("users", result.get("items"));
        model.addAttribute("pageNumbers", result.get("pageNumbers"));
        model.addAttribute("currentPageNumber",result.get("currentPageNumber"));
        return "backend/users";
    }

    @RequestMapping(value="/access-denied", method = RequestMethod.GET)
    public String accessDenied(){
        return "access-denied";
    }

    @RequestMapping(value="/backend/edit/user", method = RequestMethod.GET)
    public String newGrade(Model model, @RequestParam("id") String id){
        User_ user_ = userService.findById(id);
        if(user_ == null){
            setModelAttributeForAddUserPage(null, model);
            return "backend/adduser";
        }
        List<String> user_roles = user_.getRole_s().stream().map((role) -> role.getId().toString()).collect(Collectors.toList());
        UserDTO user  = UserDTO.builder()
        		.id(user_.getId().toString())
        		.accountExpired(user_.isAccountExpired())
        		.accountLocked(user_.isAccountLocked())
        		.credentialsExpired(user_.isCredentialsExpired())
                .status(user_.getStatus())
        		.email(user_.getEmail())
                .username(user_.getUsername())
        		.enabled(user_.isEnabled())
        		.fa2(user_.getUserDetails() != null ? ApplicationUtils.getBoolean(user_.getUserDetails().getFa2()):true)
        		.firstName(user_.getUserDetails() != null ? user_.getUserDetails().getFirstName():"")
        		.lastName(user_.getUserDetails() != null ? user_.getUserDetails().getLastName():"")
                .roleIds(user_roles)
        		.phone(user_.getUserDetails() != null ? user_.getUserDetails().getPhone():"")
        		.receiveNews(user_.getUserDetails() != null ? ApplicationUtils.getBoolean(user_.getUserDetails().getReceiveNews()):false)
        		.allowedNoOfLnd(user_.getAllowedNoOfLnd())
                .liquidityFee(user_.getLiquidityFee())
        		.build();
        setModelAttributeForAddUserPage(user, model);
        return "backend/adduser";
    }


    private void setModelAttributeForAddUserPage(UserDTO user, Model model){
        model.addAttribute("user", user);
        model.addAttribute("accountTypes", accountTypeService.getAllNonDeleted());
        List<Role_> roles = roleService.listAllNonDeleted();
        model.addAttribute("roles", roles);

        model.addAttribute("hasLiquidity", roles.stream().filter(item->item.getName().equals("LIQUIDITY")).count() > 0);

        //use this list to group the roles for the different services on the UI
        List<String> services = roles.stream().map((role_) -> role_.getMservice().getName()).distinct().collect(Collectors.toList());
        model.addAttribute("services", services);



        if(user != null && user.getId() != null && !user.getId().trim().isEmpty()){
            model.addAttribute("apiKeys", apiKeyService.findAllByUser(UUID.fromString(user.getId())));
            model.addAttribute("lndNodes", lndNodeInfoService.findByUser(UUID.fromString(user.getId())));
        }
    }

    @RequestMapping(value="/backend/add/user", method = RequestMethod.GET)
    public String newGrade(Model model){
        UserDTO user_ = UserDTO.builder()
                .enabled(true)
                .fa2(true)
                .status("NOTCONFIRM")
                .build();
        setModelAttributeForAddUserPage(user_, model);
        return "backend/adduser";
    }
    
    

    @RequestMapping(value = "/backend/add/user", method = RequestMethod.POST)
    public String createNewGrade(@Valid UserDTO userDTO, BindingResult bindingResult, Model model, RedirectAttributes redirectAttributes) {


        if (bindingResult.hasErrors()) {
            List<String> errorMessages = bindingResult.getAllErrors().stream().map((error) -> error.getDefaultMessage()).collect(Collectors.toList());
            model.addAttribute("errorMessages", errorMessages);
            setModelAttributeForAddUserPage(userDTO, model);
            return "backend/adduser";
        } else {
        	ErrorResponse response = userService.saveUser(userDTO);
        	if(response != null){
        	    List<String> errorMessages = Arrays.asList(new String[]{response.getMessage()});
                model.addAttribute("errorMessages", errorMessages);
                setModelAttributeForAddUserPage(userDTO, model);
                return "backend/adduser";
            }
        }

        redirectAttributes.addAttribute("message","User added successfully");
        return "redirect:/backend/users";
    }


    @RequestMapping(value = "/backend/apikeys", method = RequestMethod.POST)
    public String setApiKeys(@RequestParam(value="action", required=true)String action,
                             @RequestParam(value="user_id", required=true)String userId,
                             @RequestParam(value="api_key_id")String apiKey

                             ) {

        User_ user_ = userService.findById(userId);
        if(user_ != null){
            if(action.equals("ADD")){
                try {
                    String apikey = userService.generateApikey(user_);
                    return "redirect:/backend/edit/user?id="+userId;
                } catch (BadPaddingException e) {
                    e.printStackTrace();
                } catch (IllegalBlockSizeException e) {
                    e.printStackTrace();
                } catch (UnsupportedEncodingException e) {
                    e.printStackTrace();
                } catch (InvalidKeyException e) {
                    e.printStackTrace();
                }
            }else if(action.equals("DEACTIVATE") && apiKey != null){
                ApiKey apiKeyObj = apiKeyService.checkApikey(apiKey);
                if(apiKeyObj != null) {
                    apiKeyService.deactivateApikey(apiKeyObj);
                    return "redirect:/backend/edit/user?id="+userId;
                }
            }
        }
        return "redirect:/backend/users";
    }

    @RequestMapping(value="/backend/delete/user", method = RequestMethod.GET)
    public String deleteLocation(Model model,@RequestParam("userid") Optional<String> userid){
        User_ user_ = userService.findById(userid.get());
        user_.setEnabled(false);
        userService.saveUser(user_);
        return "redirect:/backend/users";
    }
}
