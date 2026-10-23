package com.lqwd.security.oauth2.controller.admin;

import com.lqwd.security.oauth2.dto.AccountTypeDTO;
import com.lqwd.security.oauth2.model.security.AccountType;
import com.lqwd.security.oauth2.service.AccountTypeService;
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
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@Controller
public class AccountTypeController {

    @Autowired
    AccountTypeService accountTypeService;

    @RequestMapping(value="/backend/accounttypes", method = RequestMethod.GET)
    public String grades(Model model, @RequestParam("page") Optional<Integer> pageNumber,
                         @RequestParam("size") Optional<Integer> pageSize){

        int currentPage = pageNumber.orElse(1);
        int size = pageSize.orElse(50);


        //Page<Grade> page = gradeService.getPage(currentPage-1, size);
        Page<AccountType> page = accountTypeService.getAllNonDeleted(currentPage-1, size);

        model.addAttribute("page", page);

        int totalPages = page.getTotalPages();
        if (totalPages > 0) {
            List<Integer> pageNumbers = IntStream.rangeClosed(1, totalPages)
                    .boxed()
                    .collect(Collectors.toList());
            model.addAttribute("pageNumbers", pageNumbers);
        }

        return "backend/accounttypes";
    }


    @RequestMapping(value="/backend/edit/accounttype", method = RequestMethod.GET)
    public String newAccountType(Model model, @RequestParam("id") Optional<Integer> id){

    	AccountTypeDTO accountTypeDTO = accountTypeService.getAccountTypeDTO(new Long(id.get()));

        model.addAttribute("accounttype", accountTypeDTO);

        return "backend/addaccounttype";
    }

    @RequestMapping(value="/backend/add/accounttype", method = RequestMethod.GET)
    public String newAccountType(Model model){

    	AccountTypeDTO accountTypeDTO = new AccountTypeDTO();
        model.addAttribute("accounttype", accountTypeDTO);

        return "backend/addaccounttype";
    }

    @RequestMapping(value = "/backend/add/accounttype", method = RequestMethod.POST)
    public String createNewAccountType(@Valid AccountTypeDTO accountTypeDTO, BindingResult bindingResult) {

        if (bindingResult.hasErrors()) {
            return "backend/addaccounttype";
        } else {
            accountTypeService.saveAccountTypeFromDTO(accountTypeDTO);
        }
        return "redirect:/backend/accounttypes";
    }
    
    

    @RequestMapping(value="/backend/delete/accounttype", method = RequestMethod.GET)
    public String deleteAccountType(Model model,@RequestParam("id") Optional<String> id){
        AccountType accountType = accountTypeService.findAccountType(Long.parseLong(id.get()));
        accountType.setStatus("DELETED");
        accountTypeService.saveAccountType(accountType);
        return "redirect:/backend/accounttype";
    }
}
