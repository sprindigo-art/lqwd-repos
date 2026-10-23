package com.lqwd.security.oauth2.service;

import com.lqwd.security.oauth2.dto.OauthClientDTO;
import com.lqwd.security.oauth2.model.security.OauthClientDetails;
import com.lqwd.security.oauth2.repository.OauthClientDetailsRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class OauthClientDetailsService {

    @Autowired
    OauthClientDetailsRepository oauthClientDetailsRepository;
    
    
    public Page<OauthClientDetails> getAllNonDeleted(int currentPage, int amount) {
        Pageable pageble = PageRequest.of(currentPage, amount);
        return oauthClientDetailsRepository.findAllNonDeleted(pageble);

    }

    public List<OauthClientDetails> getAllNonDeleted() {
          return oauthClientDetailsRepository.listFindAllNonDeleted();
    }

    public OauthClientDetails findOauthClient(String clientid) {
        Optional<OauthClientDetails> oauthClientDetails = oauthClientDetailsRepository.findByClient(clientid);
        if(oauthClientDetails.isPresent()){
            return oauthClientDetails.get();
        }
        return null;
    }
    
    
    public OauthClientDTO getOauthClientDTO(String clientid) {
       return toDTO(findOauthClient(clientid));
    }
    
    
    
    
    public OauthClientDetails saveOauthClientFromDTO(OauthClientDTO oauthDTO) {
    	OauthClientDetails oauth = new OauthClientDetails();
    	
    	if(oauthDTO.getClientId() != null && oauthDTO.getClientId().trim().length() > 0) {
    		oauth = oauthClientDetailsRepository.findByClient(oauthDTO.getClientId()).orElse(new OauthClientDetails());
    	}

    	oauth = toModel(oauthDTO, oauth);
    	
    	oauth = saveOauthClient(oauth);
        return oauth;
    }

    public OauthClientDetails saveOauthClient(OauthClientDetails oauthClientDetails) {
        return oauthClientDetailsRepository.save(oauthClientDetails);
    }
    private OauthClientDTO toDTO(OauthClientDetails oauthC) {
    	if ( oauthC == null ) {
            return null;
        }

        OauthClientDTO oauthClientDTO = new OauthClientDTO();

        oauthClientDTO.setClientId( oauthC.getClientId() );
        oauthClientDTO.setResourceIds( oauthC.getResourceIds() );
        oauthClientDTO.setClientSecret( oauthC.getClientSecret() );
        oauthClientDTO.setScope( oauthC.getScope() );
        oauthClientDTO.setAuthorizedGrantTypes( oauthC.getAuthorizedGrantTypes() );
        oauthClientDTO.setWebServerRedirectUri( oauthC.getWebServerRedirectUri() );
        oauthClientDTO.setAuthorities( oauthC.getAuthorities() );
        oauthClientDTO.setAccessTokenValidity( String.valueOf( oauthC.getAccessTokenValidity() ) );
        oauthClientDTO.setRefreshTokenValidity( String.valueOf( oauthC.getRefreshTokenValidity() ) );
        oauthClientDTO.setAdditionalInformation( oauthC.getAdditionalInformation() );
        oauthClientDTO.setAutoapprove( oauthC.getAutoapprove() );

        return oauthClientDTO;
    }
    
    private OauthClientDetails toModel(OauthClientDTO oauthDTO, OauthClientDetails oauth) {
    	if ( oauthDTO == null ) {
            return null;
        }
    	if(oauth.getClientId() == null){
            oauth.setClientId(oauthDTO.getClientId());
            oauth.setClientSecret( oauthDTO.getClientSecret() );
        }
        oauth.setResourceIds( oauthDTO.getResourceIds() );
        oauth.setScope( oauthDTO.getScope() );
        oauth.setAuthorizedGrantTypes( oauthDTO.getAuthorizedGrantTypes() );
        oauth.setWebServerRedirectUri( oauthDTO.getWebServerRedirectUri() );
        oauth.setAuthorities( oauthDTO.getAuthorities() );
        if ( oauthDTO.getAccessTokenValidity() != null ) {
            oauth.setAccessTokenValidity( Integer.parseInt( oauthDTO.getAccessTokenValidity() ) );
        }
        if ( oauthDTO.getRefreshTokenValidity() != null ) {
            oauth.setRefreshTokenValidity( Integer.parseInt( oauthDTO.getRefreshTokenValidity() ) );
        }
        oauth.setAdditionalInformation( oauthDTO.getAdditionalInformation() );
        oauth.setAutoapprove( oauthDTO.getAutoapprove() );

        return oauth;
    }
    
    
}
