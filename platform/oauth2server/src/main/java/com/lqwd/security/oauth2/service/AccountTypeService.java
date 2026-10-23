package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.dto.AccountTypeDTO;
import com.lqwd.security.oauth2.model.security.AccountType;
import com.lqwd.security.oauth2.repository.AccountTypeRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class AccountTypeService {


    private AccountTypeRepository accountTypeRepository;
    
    

    @Autowired
    public AccountTypeService(AccountTypeRepository accountTypeRepository){
        this.accountTypeRepository = accountTypeRepository;
    }

    public AccountType findById(){
        Optional<AccountType> accountType = accountTypeRepository.findById(1L);

        if(accountType.isPresent()){
            return accountType.get();
        }
        return null;
    }

    public Page<AccountType> getAllNonDeleted(int currentPage, int size) {
        Pageable pageable = PageRequest.of(currentPage, size);
        Page<AccountType> page = accountTypeRepository.findAllNonDeleted(pageable);
        return page;
    }

    public AccountType findAccountType(Long id) {
        Optional<AccountType> accountType = accountTypeRepository.findById(id);
        if(accountType.isPresent()) {
            return accountType.get();
        }
        return null;
    }
    
    public AccountTypeDTO getAccountTypeDTO(Long id) {
          return toDTO(findAccountType(id));
    }

    public AccountType saveAccountTypeFromDTO(AccountTypeDTO accountTypeDTO) {
    	AccountType accountType = new AccountType();
    	if(accountTypeDTO.getId() != null) {
    		accountType = accountTypeRepository.findById(accountTypeDTO.getId()).get();
    	}
    	accountType = toAccountType(accountTypeDTO, accountType);
    	if(accountType.getStatus() == null) {
    		accountType.setStatus("active");
    	}
    	accountType = saveAccountType(accountType);
        return accountType;
    }
    
    
    public AccountType saveAccountType(AccountType accountType) {
       return accountTypeRepository.save(accountType);
    }

    public List<AccountType> getAllNonDeleted() {
        return accountTypeRepository.getAllNonDeleted();
    }
    
    private AccountTypeDTO toDTO(AccountType accountType) {
    	if(accountType == null) {
    		return null;
    	}
    	AccountTypeDTO dto = new AccountTypeDTO();
    	dto.setDescription(accountType.getDescription());
    	dto.setId(accountType.getId());
    	dto.setName(accountType.getName());
    	dto.setStatus(accountType.getStatus());
    	return dto;
    }
    
    private AccountType toAccountType(AccountTypeDTO dto, AccountType accountType) {
    	if ( dto == null ) {
            return null;
        }

        accountType.setName( dto.getName() );
        accountType.setDescription( dto.getDescription() );
        accountType.setStatus( dto.getStatus() );

        return accountType;
    }
}
