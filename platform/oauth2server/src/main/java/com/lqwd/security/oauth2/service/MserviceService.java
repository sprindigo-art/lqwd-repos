package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.dto.MServiceDTO;
import com.lqwd.security.oauth2.model.security.Mservice;
import com.lqwd.security.oauth2.model.security.OauthClientDetails;
import com.lqwd.security.oauth2.repository.MserviceRepository;
import com.lqwd.security.oauth2.repository.OauthClientDetailsRepository;
import com.lqwd.security.oauth2.repository.RoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class MserviceService {

    private final MserviceRepository mserviceRepository;

    private final OauthClientDetailsRepository oauthClientDetailsRepository;

    private final RoleRepository roleRepository;
    

    public Mservice findByClientId(String clientId){
        Optional<Mservice> mservice = mserviceRepository.findByClient(clientId);
        if(mservice.isPresent()){
            return mservice.get();
        }
        return null;
    }

    public Mservice findByName(String name){
        Optional<Mservice> mservice = mserviceRepository.findByName(name);
        if(mservice.isPresent()){
            return mservice.get();
        }
        return null;
    }

    public Page<Mservice> findAll(int pageNumber, int amount){
        Pageable pageable = PageRequest.of(pageNumber, amount);
        return mserviceRepository.findAll(pageable);
    }

    public Page<Mservice> getAllNonDeleted(int pageNumber, int amount) {
        Pageable pageable = PageRequest.of(pageNumber, amount);
        return mserviceRepository.getAllNonDeleted(pageable);
    }

    public Mservice findMservice(UUID id) {
        Optional<Mservice> optionalMservice = mserviceRepository.findById(id);
        if(optionalMservice.isPresent()){
            return optionalMservice.get();
        }
        return null;
    }
    
    public MServiceDTO getMserviceDTO(UUID id) {
    	return toDTO(findMservice(id));
    }

    public Mservice saveMserviceFromDTO(MServiceDTO mserviceDTO) {
    	Mservice mservice = new Mservice();
    	if(mserviceDTO.getId() != null && mserviceDTO.getId().trim().length() > 0) {
    		mservice = mserviceRepository.findById(java.util.UUID.fromString(mserviceDTO.getId())).get();
    	}
    	mservice = toModel(mserviceDTO, mservice);
    	OauthClientDetails client = oauthClientDetailsRepository.findById(mserviceDTO.getClientId()).get();
    	mservice.setClient(client);
    	mservice.setStatus("active");
    	mservice = saveMservice(mservice);
        return mservice;
    }
    
    public Mservice saveMservice(Mservice mservice) {
    	return mserviceRepository.save(mservice);
    }
    

    public List<Mservice> findAllMservices() {
        return mserviceRepository.listAllNonDeleted();
    }
    
    
    private MServiceDTO toDTO(Mservice mservice) {
    	if ( mservice == null ) {
            return null;
        }

        MServiceDTO mServiceDTO = new MServiceDTO();

        mServiceDTO.setName( mservice.getName() );
        mServiceDTO.setUriinfo( mservice.getUriinfo() );
        mServiceDTO.setDescription( mservice.getDescription() );
        mServiceDTO.setStatus( mservice.getStatus() );

        mServiceDTO.setId( mservice.getId().toString() );
        mServiceDTO.setClientId( mservice.getClient().getClientId().toString() );

        return mServiceDTO;
    }
    
    private Mservice toModel(MServiceDTO mServiceDTO, Mservice mservice) {
    	if ( mServiceDTO == null ) {
            return null;
        }

        mservice.setName( mServiceDTO.getName() );
        mservice.setUriinfo( mServiceDTO.getUriinfo() );
        mservice.setDescription( mServiceDTO.getDescription() );
        mservice.setStatus( mServiceDTO.getStatus() );
        return mservice;
    }
}
